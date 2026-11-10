#!/usr/bin/env python3
"""Conservative public-tree check. It cannot prove absence of every possible secret."""

import argparse
import ipaddress
import re
import struct
from pathlib import Path

SKIP = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "build",
    "dist",
    "__pycache__",
    ".cache",
    ".runtime",
    ".local",
}
FORBIDDEN = {
    "auth.json",
    "profiles.json",
    "subscription-url.json",
    "profile_share.json",
    "result.json",
}
SAFE_IPS = {
    "127.0.0.1",
    "0.0.0.0",
    "239.255.255.250",
    "172.30.254.1",
    "10.255.254.1",
    "198.18.0.1",
    "1.1.1.1",
}
PATTERNS = [
    (
        "absolute user path",
        re.compile(
            r"(?:/Users/[A-Za-z0-9._ -]+/|/home/[A-Za-z0-9._ -]+/|[A-Z]:\\Users\\[A-Za-z0-9._ -]+\\)"
        ),
    ),
    (
        "embedded control token",
        re.compile(r'["\x27]token["\x27]\s*:\s*["\x27][a-fA-F0-9]{48,}["\x27]'),
    ),
    (
        "private key material",
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    ),
]


def findings(root):
    issues = []
    for file in root.rglob("*"):
        if not file.is_file() or any(
            part in SKIP for part in file.relative_to(root).parts
        ):
            continue
        relative = file.relative_to(root).as_posix()
        if (
            file.name in FORBIDDEN
            or file.suffix in [".pem", ".key", ".p12", ".ipk", ".log"]
            or file.name.startswith(".env")
        ):
            issues.append((relative, "runtime/secret artifact"))
            continue
        data = file.read_bytes()
        if file.suffix == ".png":
            if not data.startswith(b"\x89PNG\r\n\x1a\n"):
                issues.append((relative, "invalid PNG"))
                continue
            pos = 8
            while pos + 12 <= len(data):
                length = struct.unpack(">I", data[pos : pos + 4])[0]
                kind = data[pos + 4 : pos + 8]
                if kind in [b"tEXt", b"zTXt", b"iTXt", b"eXIf"]:
                    issues.append((relative, "unreviewed image metadata"))
                pos += length + 12
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            issues.append((relative, "unreviewed binary file"))
            continue
        for label, pattern in PATTERNS:
            if pattern.search(text):
                issues.append((relative, label))
        for match in re.finditer(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])", text):
            address = match.group(0)
            try:
                ip = ipaddress.ip_address(address)
            except ValueError:
                continue
            if (
                relative.startswith("tests/") or relative == "tools/privacy_check.py"
            ) and address in {"172.30.1.2", "10.1.1.2"}:
                continue
            if address in SAFE_IPS or any(
                ip in ipaddress.ip_network(net)
                for net in ["192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"]
            ):
                continue
            # Generic masks are not endpoints.
            if address in [
                "255.255.0.0",
                "255.0.0.0",
                "255.255.255.0",
                "255.255.255.255",
            ]:
                continue
            if ip.is_private and not address.startswith("0."):
                issues.append((relative, "unexpected private IPv4 literal"))
    return sorted(set(issues))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parent.parent
    )
    args = parser.parse_args()
    result = findings(args.root.resolve())
    for file, reason in result:
        print(file + ": " + reason)
    if result:
        raise SystemExit(1)
    print(
        "Public-tree checks passed. Review changes and Git history before publication."
    )
