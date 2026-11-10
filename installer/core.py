"""Prepare verified payloads and serve one explicitly selected television."""

from __future__ import annotations

import hashlib
import io
import ipaddress
import json
import os
import secrets
import socket
import tarfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.1.0"
FUNCTIONS = "/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/"


def validate_tv(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("A private IPv4 address is required.")
    address = ipaddress.ip_address(value.strip())
    if (
        address.version != 4
        or address.is_loopback
        or address.is_multicast
        or not address.is_private
        or address.is_unspecified
    ):
        raise ValueError("A private, unicast IPv4 address is required.")
    return str(address)


def local_address(tv: str) -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect((tv, 9))
        return sock.getsockname()[0]


def discover(timeout: float = 2.0) -> list[tuple[str, str]]:
    found = {}
    request = b'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n'
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(0.25)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        sock.sendto(request, ("239.255.255.250", 1900))
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                data, peer = sock.recvfrom(8192)
            except socket.timeout:
                continue
            source = data.decode("utf-8", "replace")
            if "hisense" in source.lower() or "vidaa" in source.lower():
                try:
                    found[validate_tv(peer[0])] = "VIDAA / Hisense"
                except ValueError:
                    pass
    return sorted(found.items())


def download(url: str, expected: str, target: Path, progress=lambda _: None) -> Path:
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
        return target
    if not url.startswith("https://"):
        raise ValueError("HTTPS_REQUIRED")
    part = target.with_suffix(target.suffix + ".part")
    digest = hashlib.sha256()
    size = 0
    try:
        with (
            urllib.request.urlopen(
                urllib.request.Request(
                    url, headers={"User-Agent": "VIDAA-VPN-Installer/" + VERSION}
                ),
                timeout=30,
            ) as response,
            part.open("wb") as out,
        ):
            if response.url.split(":", 1)[0] != "https":
                raise ValueError("HTTPS_REQUIRED")
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 200 * 1024 * 1024:
                    raise ValueError("DOWNLOAD_TOO_LARGE")
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != expected:
            raise ValueError("CHECKSUM_FAILED")
        part.replace(target)
        progress(target.name)
        return target
    finally:
        part.unlink(missing_ok=True)


def binary_from_tar(archive: Path, name: str, expected: str) -> bytes:
    with tarfile.open(archive, "r:gz") as source:
        matches = [
            member
            for member in source.getmembers()
            if Path(member.name).name == name and member.isfile()
        ]
        if len(matches) != 1 or matches[0].size > 120 * 1024 * 1024:
            raise ValueError("INVALID_ARCHIVE")
        handle = source.extractfile(matches[0])
        data = handle.read(120 * 1024 * 1024 + 1)
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("CHECKSUM_FAILED")
    if not data.startswith(b"\x7fELF"):
        raise ValueError("NOT_ELF")
    return data


def tar_bytes(entries: dict[str, tuple[bytes, int]]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, (body, mode) in entries.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(body)
            entry.mode = mode
            entry.mtime = 0
            tar.addfile(entry, io.BytesIO(body))
    return buf.getvalue()


def ipk(identifier: str, postinst: str) -> bytes:
    if not identifier.replace(".", "").replace("-", "").isalnum():
        raise ValueError("INVALID_PACKAGE_ID")
    control = (
        "Package: "
        + identifier
        + "\nVersion: "
        + VERSION
        + "\nArchitecture: mtk9655\nAppId: "
        + identifier
        + "\nAppName: VIDAA VPN\nSection: ns\nPriority: optional\nMaintainer: VIDAA VPN contributors\nDescription: Explicit local VPN management\nFormat: 1\nPersistent: false\nPackageType: Entry\nUserid: 0:0\nInstalled-Size: 1\n"
    ).encode()
    files = {
        "debian-binary": b"2.0\n",
        "control.tar.gz": tar_bytes(
            {"./control": (control, 0o644), "./postinst": (postinst.encode(), 0o755)}
        ),
        "data.tar.gz": tar_bytes({}),
    }
    result = bytearray(b"!<arch>\n")
    for name, data in files.items():
        header = f"{name + '/':<16}{0:<12}{0:<6}{0:<6}{'100644':<8}{len(data):<10}`\n".encode()
        if len(header) != 60:
            raise ValueError("AR_HEADER_INVALID")
        result.extend(header)
        result.extend(data)
        if len(data) % 2:
            result.extend(b"\n")
    return bytes(result)


def capsule(command: str) -> bytes:
    scripts = {
        "start": "actions.js start",
        "stop": "actions.js stop",
        "apply": "actions.js apply",
        "probe": "probe-root.js",
        "security": "security-root.js",
    }
    if command not in scripts:
        raise ValueError("INVALID_ACTION")
    return ipk(
        "local.vidaa.vpn." + command,
        "#!/bin/sh\n/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix /APPS/vidaa-vpn/"
        + scripts[command]
        + " >/dev/null 2>&1 </dev/null &\nexit 0\n",
    )


class Session:
    def __init__(
        self,
        tv: str,
        language="en",
        operation="install",
        progress=lambda _: None,
        cache: Path | None = None,
    ):
        self.tv = validate_tv(tv)
        self.host = local_address(self.tv)
        if language not in ["ru", "en"] or operation not in ["install", "remove"]:
            raise ValueError("INVALID_MODE")
        self.language = language
        self.operation = operation
        self.progress = progress
        self.nonce = secrets.token_hex(8)
        self.stage = "/APPS/vidaa-vpn-setup-" + self.nonce
        self.package = "local.vidaa.vpn.setup." + self.nonce
        self.path = "/s/" + secrets.token_urlsafe(6)
        self.started = time.monotonic()
        self.state = "preparing"
        self.jobs = []
        self.assigned = set()
        self.completed = set()
        self.files = {}
        self.report = None
        self.lock = threading.Lock()
        self.sequence = 0
        self.server = None
        self.prepared = False
        self.expiry = None
        self.cache = (
            cache
            or Path(os.environ.get("LOCALAPPDATA", Path.home() / ".cache"))
            / "vidaa-vpn"
        )
        self.cache.mkdir(parents=True, exist_ok=True)
        try:
            self.cache.chmod(0o700)
        except OSError:
            pass

    def add(self, op, **data):
        with self.lock:
            self.sequence += 1
            self.jobs.append({"id": str(self.sequence), "op": op, **data})

    def prepare(self):
        payload = {}
        if self.operation == "install":
            manifest = json.loads((ROOT / "installer/runtimes.json").read_text())
            for name in ["sing-box", "mieru"]:
                info = manifest[name]
                archive = download(
                    info["url"],
                    info["archive_sha256"],
                    self.cache / (name + "-" + info["version"] + ".tar.gz"),
                    self.progress,
                )
                payload[name] = binary_from_tar(
                    archive, info["binary"], info["binary_sha256"]
                )
            info = manifest["ca"]
            payload["ca-bundle.pem"] = download(
                info["url"], info["sha256"], self.cache / "ca-bundle.pem", self.progress
            ).read_bytes()
            for p in (ROOT / "native").glob("*"):
                if p.suffix in [".js", ".json"] and p.name != "install-root.js":
                    payload[p.name] = p.read_bytes()
            for p in (ROOT / "web").rglob("*"):
                if p.is_file():
                    payload["web/" + p.relative_to(ROOT / "web").as_posix()] = (
                        p.read_bytes()
                    )
            for action in ["start", "stop", "apply", "probe", "security"]:
                payload[action + ".ipk"] = capsule(action)
        hashes = {}
        for name, data in payload.items():
            self.files["payload/" + name] = data
            hashes["payload/" + name] = hashlib.sha256(data).hexdigest()
        self.files["root.js"] = (ROOT / "native/install-root.js").read_bytes()
        self.files["plan.json"] = json.dumps(
            {
                "version": VERSION,
                "language": self.language,
                "operation": self.operation,
                "hashes": hashes,
                "productionFiles": list(payload),
            }
        ).encode()
        self.files["setup.ipk"] = ipk(
            self.package,
            "#!/bin/sh\n/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix "
            + self.stage
            + "/root.js >/dev/null 2>&1 </dev/null &\nexit 0\n",
        )
        self.files["superwatch.js"] = (ROOT / "native/superwatch.js").read_bytes()
        common = "'use strict';const fs=require('fs'),cp=require('child_process');\n"
        self.files["preflight.js"] = (
            common
            + "module.exports=async function(){try{let machine;try{machine=cp.execFileSync('/bin/uname',['-m'],{encoding:'utf8',timeout:2000}).trim();}catch(e){machine='unknown';}return {ok:Number(process.versions.node.split('.')[0])>=16&&machine==='aarch64'&&fs.existsSync('/dev/net/tun')&&fs.existsSync('/var/run/superwatch_socket'),machine,tun:fs.existsSync('/dev/net/tun'),phoenix:fs.existsSync('/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix')};}finally{try{fs.unlinkSync(__filename);}catch(e){}}};"
        ).encode()
        self.files["prepare.js"] = (
            common
            + "module.exports=async function(){try{const p="
            + json.dumps(self.stage)
            + ";if(fs.existsSync(p))return {error:'STAGING_COLLISION'};fs.mkdirSync(p,{mode:448});fs.mkdirSync(p+'/payload',{mode:448});"
            + "".join(
                "fs.mkdirSync(p+"
                + json.dumps("/payload/" + directory)
                + ",{recursive:true,mode:448});"
                for directory in sorted(
                    {
                        str(Path(n).parent).replace("\\", "/")
                        for n in payload
                        if str(Path(n).parent) != "."
                    }
                )
            )
            + "fs.writeFileSync(p+'/owner.json',JSON.stringify({owner:'vidaa-vpn-setup',nonce:"
            + json.dumps(self.nonce)
            + "}),{mode:384});return {ok:true};}finally{try{fs.unlinkSync(__filename);}catch(e){}}};"
        ).encode()
        self.files["launch.js"] = (
            common
            + "module.exports=async function(){try{const sw=require("
            + json.dumps(self.stage + "/superwatch.js")
            + ");return {response:await sw("
            + json.dumps("93:82:93;" + self.stage + "/setup.ipk;" + self.package + ";")
            + ")};}finally{try{fs.unlinkSync(__filename);}catch(e){}}};"
        ).encode()
        self.files["verify.js"] = (
            common
            + "module.exports=async function(){try{const p="
            + json.dumps(self.stage + "/result.json")
            + ";return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{pending:true};}finally{try{fs.unlinkSync(__filename);}catch(e){}}};"
        ).encode()
        self.files["cleanup.js"] = (
            common
            + "module.exports=async function(){try{const p="
            + json.dumps(self.stage)
            + ",owner=JSON.parse(fs.readFileSync(p+'/owner.json'));if(owner.nonce!=="
            + json.dumps(self.nonce)
            + ")return {error:'OWNER_MISMATCH'};const sw=fs.existsSync(p+'/superwatch.js')?require(p+'/superwatch.js'):null;const response=sw?await sw("
            + json.dumps("94:83:94;" + self.package)
            + "): '94:0';fs.rmSync(p,{recursive:true});return {ok:response==='94:0'};}finally{try{fs.unlinkSync(__filename);}catch(e){}}};"
        ).encode()
        self.add("invoke", asset="preflight.js", phase="preflight")
        self.state = "ready"

    def next_job(self):
        with self.lock:
            for job in self.jobs:
                if job["id"] not in self.assigned:
                    self.assigned.add(job["id"])
                    self.progress(
                        ("COPYING " + job.get("asset", ""))
                        if job["op"] == "place"
                        else job.get("phase", "CHECKING").upper()
                    )
                    return job
        return {"op": "wait"}

    def result(self, data):
        if data.get("id") == "browser":
            self.fail(data.get("error", "PLATFORM_UNSUPPORTED"))
            return
        job = next((x for x in self.jobs if x.get("id") == data.get("id")), None)
        if not job or job["id"] not in self.assigned or job["id"] in self.completed:
            return
        self.completed.add(job["id"])
        if (
            self.state in ["failed", "cleaning_failed"]
            and job.get("phase") != "cleanup_failure"
        ):
            return
        result = data.get("result", {})
        phase = job.get("phase")
        result = result if isinstance(result, dict) else {"error": "INVALID_REPLY"}
        if phase == "cleanup_failure" and (data.get("error") or result.get("error")):
            self.report["cleanup"] = "incomplete"
            self.state = "failed"
            self.add("finish", ok=False, code=self.report["code"])
            return
        if data.get("error") or result.get("error"):
            self.fail(result.get("error", "DEVICE_REQUEST_FAILED"))
            return
        if phase == "preflight":
            if not result.get("ok") or not result.get("phoenix"):
                self.fail("PLATFORM_UNSUPPORTED")
                return
            self.add("invoke", asset="prepare.js", phase="prepare")
        elif phase == "prepare":
            self.prepared = True
            for name in self.files:
                if name.startswith("payload/") or name in [
                    "root.js",
                    "plan.json",
                    "setup.ipk",
                    "superwatch.js",
                ]:
                    self.add(
                        "place", asset=name, target=self.stage + "/" + name, mode=0o600
                    )
            self.add("invoke", asset="launch.js", phase="launch")
        elif phase == "launch":
            if result.get("response") != "93:0":
                self.fail("INSTALLER_DENIED")
                return
            self.add("invoke", asset="verify.js", phase="verify")
        elif phase == "verify":
            if result.get("pending"):
                if time.monotonic() - self.started > 1100:
                    self.fail("SETUP_TIMEOUT")
                else:
                    self.add("invoke", asset="verify.js", phase="verify")
            elif not result.get("ok"):
                self.fail(result.get("code", "INSTALL_FAILED"))
            else:
                self.report = result
                self.add("invoke", asset="cleanup.js", phase="cleanup")
        elif phase == "cleanup_failure":
            self.state = "failed"
            self.add("finish", ok=False, code=self.report["code"])
        elif phase == "cleanup":
            if not result.get("ok"):
                self.fail("CLEANUP_FAILED")
                return
            self.state = "complete"
            self.progress("COMPLETE")
            self.add("finish", ok=True, removed=self.operation == "remove")

    def fail(self, code):
        if self.state in ["failed", "cleaning_failed"]:
            return
        self.state = "cleaning_failed" if self.prepared else "failed"
        self.report = {"ok": False, "code": str(code)[:80]}
        self.progress("FAILED: " + str(code)[:80])
        with self.lock:
            self.assigned.update(job["id"] for job in self.jobs)
        if self.prepared:
            self.add("invoke", asset="cleanup.js", phase="cleanup_failure")
        else:
            self.add("finish", ok=False, code=str(code)[:80])

    def serve(self, port=0):
        session = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def send(self, body, kind="application/json"):
                body = json.dumps(body).encode() if kind == "application/json" else body
                self.send_response(200)
                self.send_header("Content-Type", kind)
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def allowed(self):
                return (
                    self.client_address[0] == session.tv
                    and time.monotonic() - session.started < 1200
                )

            def do_GET(self):
                if not self.allowed():
                    self.send_error(403)
                    return
                if self.path == session.path or self.path == session.path + "/":
                    body = (
                        (ROOT / "installer/setup.html")
                        .read_text()
                        .replace("{{BASE}}", session.path)
                        .replace("{{LANG}}", session.language)
                        .replace("{{FUNCTIONS}}", FUNCTIONS)
                        .replace("{{PREFIX}}", "vidaa_vpn_setup_" + session.nonce)
                    )
                    self.send(body.encode(), "text/html; charset=utf-8")
                    return
                if self.path == session.path + "/next":
                    self.send(session.next_job())
                    return
                prefix = session.path + "/files/"
                if self.path.startswith(prefix):
                    name = self.path[len(prefix) :]
                    if name in session.files:
                        self.send(session.files[name], "application/octet-stream")
                        return
                self.send_error(404)

            def do_POST(self):
                if not self.allowed() or self.path != session.path + "/result":
                    self.send_error(403)
                    return
                length = int(self.headers.get("Content-Length", 0))
                if not 0 < length < 16384:
                    self.send_error(413)
                    return
                try:
                    data = json.loads(self.rfile.read(length))
                    session.result(data)
                except (ValueError, KeyError, TypeError):
                    self.send_error(400)
                    return
                self.send({"ok": True})

        self.server = ThreadingHTTPServer((self.host, port), Handler)
        self.server.daemon_threads = True
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.expiry = threading.Timer(1200, self.close)
        self.expiry.daemon = True
        self.expiry.start()
        return "http://" + self.host + ":" + str(self.server.server_port) + self.path

    def close(self):
        if self.expiry:
            self.expiry.cancel()
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
