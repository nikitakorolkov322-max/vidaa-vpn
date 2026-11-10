"use strict";
const fs = require("fs"),
  cp = require("child_process"),
  https = require("https"),
  D = "/APPS/vidaa-vpn",
  started = Date.now(),
  report = { started, running: true, checks: [] };
function save() {
  const p = D + "/security.json";
  fs.writeFileSync(p + ".tmp", JSON.stringify(report), { mode: 420 });
  fs.renameSync(p + ".tmp", p);
}
function check(id, ok) {
  report.checks.push({ id, ok: !!ok });
}
(async () => {
  if (process.getuid() !== 0) return;
  save();
  const cfg = JSON.parse(fs.readFileSync(D + "/config.json")),
    db = JSON.parse(fs.readFileSync(D + "/profiles.json"));
  report.profileId = db.selected;
  check(
    "private-files",
    ["profiles.json", "config.json", "subscription-url.json"].every((n) => {
      const s = fs.statSync(D + "/" + n);
      return s.uid === 0 && (s.mode & 511) === 384;
    }),
  );
  check(
    "control-access",
    ["auth.json"].every((n) => {
      const s = fs.statSync(D + "/" + n);
      return s.uid === 0 && s.gid === 314 && (s.mode & 511) === 416;
    }),
  );
  check(
    "tls-verification",
    db.profiles.every(
      (p) =>
        p.protocol === "mieru" ||
        (p.outbound.tls && p.outbound.tls.enabled && !p.outbound.tls.insecure),
    ),
  );
  check(
    "encrypted-app-dns",
    cfg.dns.servers.some(
      (s) =>
        s.tag === cfg.dns.final &&
        s.type === "https" &&
        s.detour === "vpn" &&
        s.tls &&
        !s.tls.insecure,
    ),
  );
  check(
    "ipv6-dns",
    cfg.dns.rules.some(
      (r) =>
        r.query_type === "AAAA" &&
        r.action === "predefined" &&
        r.rcode === "NOERROR",
    ),
  );
  check(
    "local-proxies",
    cfg.inbounds.every(
      (i) => i.type === "tun" || ["127.0.0.1", "::1"].includes(i.listen),
    ),
  );
  check(
    "manual-start",
    !fs.existsSync("/var/local/DebugPowerup") &&
      !fs.existsSync("/var/local/DebugPFM_Ctrl"),
  );
  check("trusted-ca", fs.statSync(D + "/ca-bundle.pem").size > 50000);
  check(
    "ipv6-tunnel",
    cfg.inbounds.some(
      (i) => i.type === "tun" && i.address.some((a) => a.includes(":")),
    ),
  );
  const active = fs.existsSync("/sys/class/net/vvpn0");
  report.vpnRunning = active;
  if (active) {
    report.connectivity = await new Promise((resolve) => {
      let done = false;
      function end(r) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      }
      const q = https.get(
        "https://www.cloudflare.com/cdn-cgi/trace",
        {
          family: 4,
          agent: false,
          ca: fs.readFileSync(D + "/ca-bundle.pem"),
          timeout: 8000,
        },
        (r) => {
          let s = "";
          r.on("data", (b) => {
            s += b;
            if (s.length > 10000) r.destroy();
          });
          r.on("end", () => {
            const country = (s.match(/(?:^|\n)loc=([^\r\n]+)/) || [])[1];
            end({
              ok: r.statusCode === 200 && !!country,
              country: country || null,
              ms: Date.now() - started,
            });
          });
        },
      );
      const timer = setTimeout(() => {
        q.destroy();
        end({ ok: false, error: "timeout" });
      }, 10000);
      q.on("error", () => end({ ok: false, error: "connection" }));
    });
  }
  report.running = false;
  report.finished = Date.now();
  save();
})().catch(() => {
  report.running = false;
  report.error = "check-failed";
  save();
});
setTimeout(() => process.exit(0), 14000).unref();
