#!/usr/bin/env python3
"""Launch the local browser wizard, or use --cli. No third-party Python packages required."""

from __future__ import annotations

import argparse
import json
import secrets
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from installer.core import Session, discover, validate_tv


class Wizard:
    def __init__(self):
        self.secret = secrets.token_urlsafe(24)
        self.stopped = threading.Event()
        self.session = None
        self.status = "idle"
        self.progress = ""
        self.error = None
        self.url = None

    def update(self, message):
        self.progress = message

    def start(self, data):
        if data.get("authorized") is not True:
            raise ValueError("AUTHORIZATION_REQUIRED")
        active = (
            self.session.state
            if self.session and self.status == "ready"
            else self.status
        )
        if active not in ["idle", "failed", "complete"]:
            raise ValueError("SESSION_ACTIVE")
        tv = validate_tv(data.get("tv", ""))
        language = data.get("language", "en")
        operation = data.get("operation", "install")
        if self.session:
            self.session.close()
        self.status = "preparing"
        self.error = None
        self.url = None

        def work():
            try:
                self.session = Session(tv, language, operation, self.update)
                self.session.prepare()
                try:
                    self.url = self.session.serve(8765)
                except OSError:
                    self.url = self.session.serve(0)
                self.status = "ready"
            except Exception as error:
                self.error = str(error)[:200]
                self.status = "failed"

        threading.Thread(target=work, daemon=True).start()

    def run(self, open_browser=True):
        wizard = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def send(self, data, kind="application/json"):
                body = json.dumps(data).encode() if kind == "application/json" else data
                self.send_response(200)
                self.send_header("Content-Type", kind)
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_GET(self):
                if self.path == "/" + wizard.secret:
                    body = (
                        (Path(__file__).resolve().parent / "installer/wizard.html")
                        .read_text()
                        .replace("{{TOKEN}}", wizard.secret)
                    )
                    self.send(body.encode(), "text/html; charset=utf-8")
                    return
                if (
                    self.path == "/api/status"
                    and self.headers.get("X-Installer-Key") == wizard.secret
                ):
                    status = (
                        wizard.session.state
                        if wizard.session and wizard.status == "ready"
                        else wizard.status
                    )
                    self.send(
                        {
                            "state": status,
                            "progress": wizard.progress,
                            "error": wizard.error,
                            "url": wizard.url,
                            "report": wizard.session.report if wizard.session else None,
                        }
                    )
                    return
                self.send_error(404)

            def do_POST(self):
                if self.headers.get("X-Installer-Key") != wizard.secret:
                    self.send_error(403)
                    return
                n = int(self.headers.get("Content-Length", 0))
                if not 0 <= n < 4096:
                    self.send_error(413)
                    return
                try:
                    data = json.loads(self.rfile.read(n) or b"{}")
                    if self.path == "/api/start":
                        wizard.start(data)
                        self.send({"ok": True})
                    elif self.path == "/api/discover":
                        self.send({"devices": discover()})
                    elif self.path == "/api/stop":
                        self.send({"ok": True})
                        wizard.stopped.set()
                    else:
                        self.send_error(404)
                except (ValueError, TypeError, KeyError) as error:
                    self.send({"error": str(error)[:100]})

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = "http://127.0.0.1:" + str(server.server_port) + "/" + self.secret
        print("VIDAA VPN installer:", url, flush=True)
        if open_browser:
            webbrowser.open(url)
        try:
            self.stopped.wait(1800)
        except KeyboardInterrupt:
            pass
        finally:
            if self.session:
                self.session.close()
            server.shutdown()
            server.server_close()


def main():
    parser = argparse.ArgumentParser(description="VIDAA VPN local installer")
    parser.add_argument("--cli", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--tv")
    parser.add_argument("--language", choices=["ru", "en"], default="en")
    parser.add_argument("--remove", action="store_true")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate shipped resources without downloading or contacting a TV",
    )
    args = parser.parse_args()
    if args.dry_run:
        base = Path(__file__).resolve().parent
        for path in [
            "web/template.html",
            "web/app.js",
            "native/install-root.js",
            "installer/runtimes.json",
            "installer/setup.html",
            "installer/wizard.html",
        ]:
            if not (base / path).is_file():
                raise SystemExit("Missing resource: " + path)
        json.loads((base / "installer/runtimes.json").read_text())
        print("Resource checks passed; no TV contacted.")
        return
    if not args.cli:
        Wizard().run(not args.no_browser)
        return
    tv = validate_tv(args.tv or input("TV IPv4: "))
    if input("I own or am authorized to administer this TV. Type YES: ") != "YES":
        raise SystemExit("Cancelled")
    session = Session(tv, args.language, "remove" if args.remove else "install", print)
    try:
        session.prepare()
        try:
            url = session.serve(8765)
        except OSError:
            url = session.serve(0)
        print("Open this URL in the TV browser:", url, flush=True)
        while session.state not in ["complete", "failed"]:
            time.sleep(0.5)
        print(json.dumps(session.report))
        time.sleep(2)
    finally:
        session.close()


if __name__ == "__main__":
    main()
