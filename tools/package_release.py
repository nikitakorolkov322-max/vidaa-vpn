#!/usr/bin/env python3
"""Wrap a locally built installer with notices, guides and a checksum."""

import hashlib
import platform
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
system = {"darwin": "macos", "win32": "windows"}.get(sys.platform, "linux")
arch = platform.machine().lower().replace("x86_64", "x64").replace("amd64", "x64")
folder = ROOT / "dist"
application = folder / "VIDAA-VPN-Installer.app"
if not application.exists():
    application = folder / (
        "VIDAA-VPN-Installer.exe" if sys.platform == "win32" else "VIDAA-VPN-Installer"
    )
if not application.exists():
    raise SystemExit("Build the installer first.")
archive = folder / ("VIDAA-VPN-Installer-" + system + "-" + arch + ".zip")
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
    for p in application.rglob("*") if application.is_dir() else [application]:
        if p.is_file():
            output.write(p, p.relative_to(folder).as_posix())
    for name in [
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "docs/guide.en.md",
        "docs/guide.ru.md",
        "SECURITY.md",
        "PRIVACY.md",
    ]:
        output.write(ROOT / name, name)
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
(folder / (archive.name + ".sha256")).write_text(checksum + "  " + archive.name + "\n")
print(archive.name)
