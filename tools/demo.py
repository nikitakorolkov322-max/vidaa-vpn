#!/usr/bin/env python3
"""Loopback-only UI demo. All servers, statistics and results are synthetic."""

from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROFILES = [
    {"id": format(i + 1, "020x"), "title": title, "protocol": protocol}
    for i, (title, protocol) in enumerate(
        [
            ("Germany", "vless"),
            ("Finland", "anytls"),
            ("Netherlands", "naive"),
            ("Poland", "mieru"),
        ]
    )
]
STATE = {
    "running": False,
    "memoryMiB": 0,
    "settings": {
        "profiles": PROFILES,
        "selected": PROFILES[0]["id"],
        "subscriptionHost": "subscription.example",
        "updated": 0,
    },
    "session": {"started": None, "download": None, "upload": None},
    "probes": None,
    "security": None,
    "result": None,
}


def now():
    return int(time.time() * 1000)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        name = self.path.split("?")[0]
        if name == "/":
            name = "/ru/index.html"
        path = (ROOT / "web" / name.lstrip("/")).resolve()
        if not path.is_relative_to((ROOT / "web").resolve()) or not path.is_file():
            self.send_error(404)
            return
        types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
        }
        self.send_response(200)
        self.send_header(
            "Content-Type", types.get(path.suffix, "application/octet-stream")
        )
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(path.read_bytes())

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length < 16384:
            self.send_error(400)
            return
        request = json.loads(self.rfile.read(length))
        action = request.get("action")
        timestamp = now()
        response = STATE
        if self.path == "/api/action":
            response = {"since": timestamp}
            if action == "start":
                STATE.update(running=True, memoryMiB=30)
                STATE["session"] = {
                    "started": timestamp,
                    "download": 10485760,
                    "upload": 500000,
                }
            elif action == "stop":
                STATE.update(running=False, memoryMiB=0)
                STATE["session"] = {"started": None, "download": None, "upload": None}
            elif action == "select":
                if request.get("id") not in {p["id"] for p in PROFILES}:
                    response = {"error": "SERVER_NOT_FOUND"}
                else:
                    STATE["settings"]["selected"] = request["id"]
            elif action == "update":
                if request.get("url") and not request["url"].startswith("https://"):
                    response = {"error": "HTTPS_REQUIRED"}
            elif action == "probe":
                STATE["probes"] = {
                    "started": timestamp,
                    "updated": timestamp,
                    "running": False,
                    "total": len(PROFILES),
                    "results": [
                        {"id": p["id"], "ok": True, "ms": 35 + i * 12}
                        for i, p in enumerate(PROFILES)
                    ],
                }
            elif action == "security":
                STATE["security"] = {
                    "started": timestamp,
                    "finished": timestamp,
                    "running": False,
                    "profileId": STATE["settings"]["selected"],
                    "checks": [
                        {"id": key, "ok": True}
                        for key in [
                            "private-files",
                            "control-access",
                            "tls-verification",
                            "encrypted-app-dns",
                            "ipv6-dns",
                            "local-proxies",
                            "manual-start",
                            "trusted-ca",
                            "ipv6-tunnel",
                        ]
                    ],
                    "connectivity": {
                        "ok": STATE["running"],
                        "country": "DE" if STATE["running"] else None,
                    },
                }
            else:
                response = {"error": "INVALID_ACTION"}
            if action in ["start", "stop", "select", "update"]:
                STATE["result"] = {
                    "time": timestamp,
                    "ok": not response.get("error"),
                    "code": response.get("error")
                    or {
                        "start": "on",
                        "stop": "off",
                        "select": "SERVER_SELECTED",
                        "update": "SUBSCRIPTION_UPDATED",
                    }[action],
                }
        elif self.path != "/api/status":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8780)
    args = parser.parse_args()
    print(
        f"Demo only: http://127.0.0.1:{args.port}/ru/index.html or /en/index.html",
        flush=True,
    )
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
