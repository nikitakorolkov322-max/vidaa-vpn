"use strict";
const fs = require("fs"),
  net = require("net"),
  dns = require("dns"),
  os = require("os"),
  D = "/APPS/vidaa-vpn";
let finished = false,
  lock = false;
const started = Date.now(),
  results = [],
  sockets = new Set();
function write(running) {
  const p = D + "/probes.json",
    data = {
      started,
      updated: Date.now(),
      running,
      total: profiles.length,
      results,
    };
  fs.writeFileSync(p + ".tmp", JSON.stringify(data), { mode: 420 });
  fs.renameSync(p + ".tmp", p);
}
function finish() {
  if (finished) return;
  finished = true;
  for (const p of profiles)
    if (!results.some((r) => r.id === p.id))
      results.push({ id: p.id, ok: false, error: "timeout" });
  for (const s of sockets) s.destroy();
  try {
    write(false);
  } catch (e) {}
  if (lock)
    try {
      fs.unlinkSync(D + "/probe.lock");
    } catch (e) {}
  setTimeout(() => process.exit(0), 20);
}
let profiles = [];
try {
  if (process.getuid() !== 0) throw Error();
  if (fs.existsSync(D + "/probe.lock")) {
    const m = JSON.parse(fs.readFileSync(D + "/probe.lock"));
    if (Date.now() - m.started < 25000 && fs.existsSync("/proc/" + m.pid))
      process.exit(0);
    fs.unlinkSync(D + "/probe.lock");
  }
  fs.writeFileSync(
    D + "/probe.lock",
    JSON.stringify({ started, pid: process.pid }),
    { flag: "wx", mode: 384 },
  );
  lock = true;
  profiles = JSON.parse(fs.readFileSync(D + "/profiles.json")).profiles;
} catch (e) {
  process.exit(1);
}
const native = (os.networkInterfaces().wlan0 || []).find(
  (x) => (x.family === "IPv4" || x.family === 4) && !x.internal,
);
const cache = new Map();
function address(host) {
  if (net.isIP(host) === 4) return Promise.resolve(host);
  if (!cache.has(host)) {
    cache.set(
      host,
      Promise.race([
        dns.promises.lookup(host, { family: 4 }).then((x) => x.address),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("dns-timeout")), 3500),
        ),
      ]),
    );
  }
  return cache.get(host);
}
async function probe(p) {
  try {
    if (
      p.protocol === "mieru" &&
      String(p.outbound.transport).toUpperCase() === "UDP"
    )
      return { id: p.id, ok: false, error: "udp-endpoint" };
    if (p.protocol === "naive" && p.outbound.quic)
      return { id: p.id, ok: false, error: "udp-endpoint" };
    const ip = await address(p.outbound.server);
    return await new Promise((resolve) => {
      const now = process.hrtime.bigint(),
        s = net.createConnection({
          host: ip,
          port: p.outbound.server_port,
          localAddress: native && native.address,
        });
      sockets.add(s);
      let done = false;
      function end(data) {
        if (done) return;
        done = true;
        sockets.delete(s);
        s.destroy();
        resolve(Object.assign({ id: p.id }, data));
      }
      s.setTimeout(2500);
      s.on("connect", () =>
        end({
          ok: true,
          ms: Math.max(
            1,
            Math.round(Number(process.hrtime.bigint() - now) / 1000000),
          ),
        }),
      );
      s.on("timeout", () => end({ ok: false, error: "timeout" }));
      s.on("error", () => end({ ok: false, error: "unreachable" }));
    });
  } catch (e) {
    return { id: p.id, ok: false, error: "dns" };
  }
}
setTimeout(finish, 18000);
process.on("SIGTERM", finish);
write(true);
(async () => {
  for (let i = 0; i < profiles.length && !finished; i += 4) {
    const batch = await Promise.all(profiles.slice(i, i + 4).map(probe));
    if (finished) return;
    results.push(...batch);
    write(true);
  }
  finish();
})().catch(finish);
