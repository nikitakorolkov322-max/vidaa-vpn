"use strict";
const fs = require("fs"),
  cp = require("child_process"),
  https = require("https"),
  D = "/APPS/vidaa-vpn",
  B = D + "/sing-box",
  C = D + "/config.json",
  A = process.argv[2],
  mod = require(D + "/subscription.js");
const sleep = (n) => new Promise((r) => setTimeout(r, n)),
  env = Object.assign({}, process.env, {
    LD_PRELOAD: "",
    GOMEMLIMIT: "64MiB",
    GOGC: "50",
  });
function json(p) {
  return JSON.parse(fs.readFileSync(D + "/" + p, "utf8"));
}
function atomic(n, data, mode = 384) {
  const p = D + "/" + n;
  fs.writeFileSync(p + ".tmp", JSON.stringify(data), { mode });
  fs.chmodSync(p + ".tmp", mode);
  fs.renameSync(p + ".tmp", p);
}
function proc(pid, bin = B) {
  try {
    const args = fs
      .readFileSync("/proc/" + pid + "/cmdline", "utf8")
      .split("\0");
    if (args[0] !== bin || args[1] !== "run") return null;
    if (bin === B && (args[2] !== "-c" || args[3] !== C)) return null;
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    return {
      pid,
      bin,
      start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
    };
  } catch (e) {
    return null;
  }
}
function own(n = "pid.json", bin = B) {
  try {
    const m = json(n),
      p = proc(m.pid, bin);
    return p && p.start === m.start ? p : null;
  } catch (e) {
    return null;
  }
}
function record(data) {
  atomic("result.json", Object.assign({ time: Date.now() }, data), 420);
}
function ip(args) {
  return cp.execFileSync("/sbin/ip", args, {
    encoding: "utf8",
    timeout: 5000,
    env,
  });
}
async function terminate(n, bin) {
  const p = own(n, bin);
  if (p) {
    process.kill(p.pid, "SIGTERM");
    for (let i = 0; i < 70 && own(n, bin); i++) await sleep(100);
    if (own(n, bin)) throw Error("STOP_TIMEOUT");
  }
  try {
    fs.unlinkSync(D + "/" + n);
  } catch (e) {}
}
const FW = "VIDAA_VPN_IN";
function ipt(args, ignore = false) {
  try {
    return cp.execFileSync("/usr/local/bin/iptables", args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      env,
    });
  } catch (e) {
    if (!ignore) throw Error("FIREWALL_FAILED");
    return null;
  }
}
function fwDisable() {
  if (!fs.existsSync(D + "/firewall.json")) return;
  if (json("firewall.json").owner !== FW) throw Error("FIREWALL_FAILED");
  ipt(["-D", "INPUT", "-i", "vvpn0", "-p", "tcp", "-j", FW], true);
  ipt(["-F", FW], true);
  ipt(["-X", FW], true);
  try {
    fs.unlinkSync(D + "/firewall.json");
  } catch (e) {}
}
function fwEnable() {
  if (fs.existsSync(D + "/firewall.json")) fwDisable();
  if (ipt(["-S", FW], true) !== null) throw Error("NETWORK_BUSY");
  atomic("firewall.json", { owner: FW });
  try {
    ipt(["-N", FW]);
    ipt(["-A", FW, "-j", "ACCEPT"]);
    ipt(["-I", "INPUT", "1", "-i", "vvpn0", "-p", "tcp", "-j", FW]);
  } catch (e) {
    fwDisable();
    throw e;
  }
}
async function stop() {
  await terminate("pid.json", B);
  await terminate("mieru-pid.json", D + "/mieru");
  fwDisable();
  if (
    fs.existsSync("/sys/class/net/vvpn0") ||
    /lookup 22032|^2910[0-9]:|^29110:/m.test(ip(["rule", "show"]))
  )
    throw Error("NETWORK_CLEANUP_FAILED");
}
function spawn(bin, args, extra) {
  const child = cp.spawn(bin, args, {
    cwd: D,
    detached: true,
    stdio: "ignore",
    env: Object.assign({}, env, extra || {}),
  });
  child.on("error", () => {});
  child.unref();
  return child;
}
async function start() {
  if (own()) return;
  if (
    fs.existsSync("/sys/class/net/vvpn0") ||
    /lookup 22032|^2910[0-9]:|^29110:/m.test(ip(["rule", "show"]))
  )
    throw Error("NETWORK_BUSY");
  let db = json("profiles.json"),
    profile = db.profiles.find((p) => p.id === db.selected);
  if (!profile) throw Error("NO_SERVER");
  const fresh = mod.config(json("template.json"), profile, D);
  fresh.config.inbounds.find((i) => i.type === "tun").address[0] = require(
    D + "/network.js",
  ).choose(require("os").networkInterfaces());
  atomic("config.json", fresh.config);
  cp.execFileSync(B, ["check", "-c", C], {
    timeout: 10000,
    stdio: "ignore",
    env,
  });
  if (profile.protocol === "mieru") {
    const c = fresh;
    const address = (
      await Promise.race([
        require("dns").promises.lookup(profile.outbound.server, { family: 4 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("DNS_FAILED")), 8000),
        ),
      ])
    ).address;
    c.mieru.profiles[0].servers[0].ipAddress = address;
    delete c.mieru.profiles[0].servers[0].domainName;
    c.config.inbounds
      .find((x) => x.type === "tun")
      .route_exclude_address.push(address + "/32");
    atomic("config.json", c.config);
    c.mieru.rpcPort = 0;
    atomic("mieru-config.json", c.mieru);
    const child = spawn(D + "/mieru", ["run"], {
      MIERU_CONFIG_JSON_FILE: D + "/mieru-config.json",
    });
    await sleep(700);
    const p = proc(child.pid, D + "/mieru");
    if (!p) throw Error("MIERU_START_FAILED");
    atomic("mieru-pid.json", p, 420);
  }
  try {
    fwEnable();
  } catch (error) {
    await terminate("mieru-pid.json", D + "/mieru");
    throw error;
  }
  const child = spawn(B, ["run", "-c", C]);
  await sleep(1800);
  const p = proc(child.pid);
  if (!p || !fs.existsSync("/sys/class/net/vvpn0")) {
    if (p) process.kill(p.pid, "SIGTERM");
    await terminate("mieru-pid.json", D + "/mieru");
    fwDisable();
    throw Error("START_FAILED");
  }
  atomic("pid.json", Object.assign(p, { startedAt: Date.now() }), 420);
}
function publicState(db, sub) {
  atomic(
    "public.json",
    {
      profiles: db.profiles.map((p) => ({
        id: p.id,
        title: p.title,
        protocol: p.protocol,
      })),
      selected: db.selected,
      subscriptionHost: sub ? new URL(sub.url).hostname : "",
      updated: Date.now(),
    },
    420,
  );
}
function download(url, remaining = 3) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        url.length > 8192
      )
        throw Error();
    } catch (e) {
      return reject(Error("HTTPS_REQUIRED"));
    }
    const q = https.get(
      u,
      {
        ca: fs.readFileSync(D + "/ca-bundle.pem"),
        family: 4,
        agent: false,
        headers: {
          "User-Agent": "sing-box/1.14.4",
          Accept: "application/json,text/plain,*/*",
        },
        timeout: 20000,
      },
      (r) => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode)) {
          r.resume();
          if (!remaining) return reject(Error("REDIRECT_LIMIT"));
          return download(
            new URL(r.headers.location, u).href,
            remaining - 1,
          ).then(resolve, reject);
        }
        if (r.statusCode !== 200) {
          r.resume();
          return reject(Error("HTTP_ERROR"));
        }
        let total = 0,
          chunks = [];
        r.on("data", (b) => {
          total += b.length;
          if (total > 4194304) r.destroy(Error("SUBSCRIPTION_TOO_LARGE"));
          else chunks.push(b);
        });
        r.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        r.on("error", () => reject(Error("DOWNLOAD_FAILED")));
      },
    );
    const deadline = setTimeout(
      () => q.destroy(Error("DOWNLOAD_TIMEOUT")),
      20000,
    );
    q.on("close", () => clearTimeout(deadline));
    q.on("timeout", () => q.destroy(Error("DOWNLOAD_TIMEOUT")));
    q.on("error", () => reject(Error("DOWNLOAD_FAILED")));
  });
}
async function apply() {
  const req = json("requests/action.json");
  fs.unlinkSync(D + "/requests/action.json");
  let db = json("profiles.json"),
    sub = json("subscription-url.json");
  const before = JSON.parse(JSON.stringify(db)),
    beforeSub = sub,
    beforeConfig = json("config.json"),
    was = !!own();
  if (req.op === "select") {
    if (
      !/^[a-f0-9]{20}$/.test(String(req.id)) ||
      !db.profiles.some((p) => p.id === req.id)
    )
      throw Error("SERVER_NOT_FOUND");
    db.selected = req.id;
  } else if (req.op === "update") {
    const url = req.url || sub.url;
    if (typeof url !== "string" || !url) throw Error("NO_SUBSCRIPTION");
    let parsed;
    try {
      parsed = mod.parse(await download(url));
    } catch (e) {
      if (/^[A-Z_]+$/.test(e.message)) throw e;
      throw Error("FORMAT_UNSUPPORTED");
    }
    const old = db.profiles.find((p) => p.id === db.selected),
      selected =
        parsed.profiles.find((p) => p.id === db.selected) ||
        parsed.profiles.find(
          (p) =>
            old &&
            p.protocol === old.protocol &&
            p.outbound.server === old.outbound.server,
        ) ||
        parsed.profiles.find((p) => p.protocol === "vless") ||
        parsed.profiles[0];
    db = { profiles: parsed.profiles, selected: selected.id };
    sub = { url };
  } else throw Error("INVALID_ACTION");
  const selected = db.profiles.find((p) => p.id === db.selected),
    built = mod.config(json("template.json"), selected, D);
  atomic("candidate.json", built.config);
  try {
    cp.execFileSync(B, ["check", "-c", D + "/candidate.json"], {
      timeout: 10000,
      stdio: "ignore",
      env,
    });
  } catch (e) {
    throw Error("PROFILE_UNSUPPORTED");
  } finally {
    try {
      fs.unlinkSync(D + "/candidate.json");
    } catch (e) {}
  }
  try {
    if (was) await stop();
    atomic("config.json", built.config);
    atomic("profiles.json", db);
    atomic("subscription-url.json", sub);
    if (was) await start();
    publicState(db, sub);
    return {
      ok: true,
      running: !!own(),
      code: req.op === "update" ? "SUBSCRIPTION_UPDATED" : "SERVER_SELECTED",
    };
  } catch (e) {
    try {
      await stop();
      atomic("config.json", beforeConfig);
      atomic("profiles.json", before);
      atomic("subscription-url.json", beforeSub);
      if (was) await start();
      publicState(before, beforeSub);
    } catch (x) {}
    throw e;
  }
}
(async () => {
  if (process.getuid() !== 0) throw Error("ROOT_REQUIRED");
  let lock;
  try {
    const lp = D + "/action.lock";
    if (fs.existsSync(lp)) {
      let live = false;
      try {
        const m = JSON.parse(fs.readFileSync(lp, "utf8"));
        live =
          m.boot ===
            fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8") &&
          fs.existsSync("/proc/" + m.pid) &&
          fs
            .readFileSync("/proc/" + m.pid + "/cmdline", "utf8")
            .includes(D + "/actions.js");
      } catch (e) {
        live = Date.now() - fs.statSync(lp).mtimeMs < 60000;
      }
      if (live) {
        record({ ok: false, code: "BUSY" });
        return;
      }
      fs.unlinkSync(lp);
    }
    lock = fs.openSync(lp, "wx", 384);
    fs.writeFileSync(
      lock,
      JSON.stringify({
        pid: process.pid,
        boot: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8"),
      }),
    );
  } catch (e) {
    record({ ok: false, code: "BUSY" });
    return;
  }
  try {
    if (A === "start") {
      await start();
      record({ ok: true, running: true });
    } else if (A === "stop") {
      await stop();
      record({ ok: true, running: false });
    } else if (A === "apply") record(await apply());
    else throw Error("INVALID_ACTION");
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(D + "/action.lock");
  }
})().catch((e) => {
  record({
    ok: false,
    code: /^[A-Z_]+$/.test(String(e.message)) ? e.message : "ACTION_FAILED",
  });
  process.exitCode = 1;
});
