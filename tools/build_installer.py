#!/usr/bin/env python3
"""Package a browser-based wizard; no Tk or VPN binaries are embedded."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
args = [
    sys.executable,
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir" if sys.platform == "darwin" else "--onefile",
    "--name",
    "VIDAA-VPN-Installer",
    "--distpath",
    str(ROOT / "dist"),
    "--workpath",
    str(ROOT / "build"),
    "--specpath",
    str(ROOT / "build"),
]
if sys.platform in ["darwin", "win32"]:
    args += ["--windowed"]
for source, target in [
    ("web", "web"),
    ("native", "native"),
    ("installer/runtimes.json", "installer"),
    ("installer/setup.html", "installer"),
    ("installer/wizard.html", "installer"),
    ("LICENSE", "."),
    ("THIRD_PARTY_NOTICES.md", "."),
]:
    args += ["--add-data", str(ROOT / source) + os.pathsep + target]
args.append(str(ROOT / "install.py"))
subprocess.run(args, cwd=ROOT, check=True)
