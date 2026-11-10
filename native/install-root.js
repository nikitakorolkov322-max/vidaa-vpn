"use strict";
const fs = require("fs"),
  cp = require("child_process"),
  crypto = require("crypto"),
  path = require("path");
const STAGE = path.dirname(__filename),
  D = "/APPS/vidaa-vpn",
  FUNCTIONS = "/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch";
const plan = JSON.parse(fs.readFileSync(STAGE + "/plan.json")),
  report = { version: plan.version, operation: plan.operation };
let fresh = false,
  backupPath = null,
  registryBefore = null;
const changed = [],
  functionWrites = [];
function writeResult() {
  fs.writeFileSync(STAGE + "/result.json", JSON.stringify(report), {
    mode: 420,
  });
}
function put(name, data, mode = 420, gid = 0) {
  const p = D + "/" + name;
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 493 });
  fs.writeFileSync(p + ".new", data, { mode });
  fs.chownSync(p + ".new", 0, gid);
  fs.chmodSync(p + ".new", mode);
  fs.renameSync(p + ".new", p);
}
function hashFile(file) {
  const h = crypto.createHash("sha256"),
    fd = fs.openSync(file, "r"),
    chunk = Buffer.alloc(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, chunk, 0, chunk.length, null)))
      h.update(chunk.subarray(0, count));
    return h.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}
function action(command) {
  return cp.execFileSync(process.execPath, [D + "/actions.js", command], {
    timeout: 16000,
    stdio: "ignore",
    env: { ...process.env, LD_PRELOAD: "" },
  });
}
try {
  if (process.getuid() !== 0) throw Error("ROOT_REQUIRED");
  if (
    !fs.existsSync("/dev/net/tun") ||
    cp.execFileSync("/bin/uname", ["-m"], { encoding: "utf8" }).trim() !==
      "aarch64"
  )
    throw Error("PLATFORM_UNSUPPORTED");
  const exists = fs.existsSync(D);
  if (
    exists &&
    JSON.parse(fs.readFileSync(D + "/owner.json")).owner !== "vidaa-vpn-v1"
  )
    throw Error("DIRECTORY_COLLISION");
  if (plan.operation === "remove") {
    if (!exists) {
      report.ok = true;
      writeResult();
      process.exit(0);
    }
    action("stop");
    const reg = "/APPS/websdk/Appinfo.json";
    if (fs.existsSync(reg)) {
      const data = JSON.parse(fs.readFileSync(reg));
      data.AppInfo = (data.AppInfo || []).filter((e) => e.Id !== "vidaa-vpn");
      fs.writeFileSync(reg, JSON.stringify(data));
    }
    for (const n of [
      "vidaa_vpn_action.js",
      "vidaa_vpn_status.js",
      "fetchresponse_vidaa_vpn_ui.js",
      "fetchresponse_vidaa_vpn_asset.js",
    ])
      try {
        fs.unlinkSync(FUNCTIONS + "/" + n);
      } catch (_) {}
    fs.rmSync(D, { recursive: true });
    report.ok = true;
    report.removed = true;
    writeResult();
    process.exit(0);
  }
  for (const [name, sha] of Object.entries(plan.hashes)) {
    const p = path.resolve(STAGE, name);
    if (
      !p.startsWith(STAGE + "/") ||
      !fs.statSync(p).isFile() ||
      hashFile(p) !== sha
    )
      throw Error("CHECKSUM_FAILED");
  }
  if (exists) action("stop");
  const policy = cp.execFileSync("/sbin/ip", ["rule", "show"], {
    encoding: "utf8",
  });
  if (
    policy
      .split("\n")
      .filter(Boolean)
      .some((line) => !/^(0|32766|32767):/.test(line))
  )
    throw Error("OTHER_NETWORK_POLICY_ACTIVE");
  const registry = "/APPS/websdk/Appinfo.json",
    raw = fs.existsSync(registry) ? fs.readFileSync(registry, "utf8") : null,
    data = raw ? JSON.parse(raw) : { AppInfo: [] };
  if (!Array.isArray(data.AppInfo)) throw Error("REGISTRY_INVALID");
  registryBefore = raw;
  const existingEntry = data.AppInfo.find((e) => e.Id === "vidaa-vpn");
  if (
    existingEntry &&
    !String(existingEntry.URL).startsWith(
      "https://localhost:9888/function/basic/fetch/fetchresponse_vidaa_vpn_ui",
    )
  )
    throw Error("REGISTRY_COLLISION");
  if (
    !exists &&
    [
      "vidaa_vpn_action.js",
      "vidaa_vpn_status.js",
      "fetchresponse_vidaa_vpn_ui.js",
      "fetchresponse_vidaa_vpn_asset.js",
    ].some((n) => fs.existsSync(FUNCTIONS + "/" + n))
  )
    throw Error("HANDLER_COLLISION");
  if (!exists) {
    fs.mkdirSync(D, { mode: 493 });
    fresh = true;
    put("owner.json", JSON.stringify({ owner: "vidaa-vpn-v1" }));
    put(
      "auth.json",
      JSON.stringify({ token: crypto.randomBytes(32).toString("hex") }),
      416,
      314,
    );
    put("profiles.json", JSON.stringify({ profiles: [], selected: null }), 384);
    put("subscription-url.json", JSON.stringify({ url: "" }), 384);
    put(
      "public.json",
      JSON.stringify({ profiles: [], selected: null, subscriptionHost: "" }),
    );
  } else {
    const backup = D + "/backup-" + Date.now();
    backupPath = backup;
    fs.mkdirSync(backup, { mode: 448 });
    for (const name of [...plan.productionFiles, "config.json"])
      if (
        fs.existsSync(D + "/" + name) &&
        fs.statSync(D + "/" + name).isFile()
      ) {
        const p = backup + "/" + name;
        fs.mkdirSync(path.dirname(p), { recursive: true, mode: 448 });
        fs.copyFileSync(D + "/" + name, p);
        fs.chmodSync(p, 384);
      }
  }
  if (raw && !fs.existsSync(D + "/registry-before.json"))
    put("registry-before.json", raw, 384);
  for (const name of plan.productionFiles) {
    const target = D + "/" + name;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 493 });
    fs.copyFileSync(STAGE + "/payload/" + name, target + ".new");
    fs.chownSync(target + ".new", 0, 0);
    fs.chmodSync(
      target + ".new",
      ["sing-box", "mieru"].includes(name) ? 493 : 420,
    );
    fs.renameSync(target + ".new", target);
    changed.push(name);
  }
  fs.mkdirSync(D + "/requests", { recursive: true, mode: 448 });
  fs.chownSync(D + "/requests", 314, 314);
  fs.chmodSync(D + "/requests", 448);
  const template = JSON.parse(fs.readFileSync(D + "/template.json")),
    db = JSON.parse(fs.readFileSync(D + "/profiles.json"));
  const selected = db.profiles.find((p) => p.id === db.selected);
  changed.push("config.json");
  if (selected)
    put(
      "config.json",
      JSON.stringify(
        require(D + "/subscription.js").config(template, selected, D).config,
      ),
      384,
    );
  else put("config.json", JSON.stringify(template), 384);
  for (const [source, name] of [
    ["api-action.js", "vidaa_vpn_action.js"],
    ["api-status.js", "vidaa_vpn_status.js"],
    ["http-view.js", "fetchresponse_vidaa_vpn_ui.js"],
    ["http-asset.js", "fetchresponse_vidaa_vpn_asset.js"],
  ]) {
    fs.copyFileSync(D + "/" + source, FUNCTIONS + "/" + name);
    fs.chownSync(FUNCTIONS + "/" + name, 0, 314);
    fs.chmodSync(FUNCTIONS + "/" + name, 416);
    functionWrites.push(name);
  }
  const icon = (size) =>
    "data:image/png;base64," +
    fs.readFileSync(D + "/web/logo-" + size + ".png").toString("base64");
  const url =
    "https://localhost:9888/function/basic/fetch/fetchresponse_vidaa_vpn_ui?lang=" +
    plan.language;
  const entry = {
    Id: "vidaa-vpn",
    AppName: "VIDAA VPN",
    Title: "VIDAA VPN",
    URL: url,
    StartCommand: url,
    IconURL: icon(400),
    Icon_96: icon(96),
    Image: icon(400),
    Thumb: icon(400),
    Type: "Browser",
    InstallTime: new Date().toISOString().slice(0, 10),
    RunTimes: 0,
    StoreType: "custom",
    PreInstall: false,
  };
  data.AppInfo = data.AppInfo.filter((e) => e.Id !== "vidaa-vpn");
  data.AppInfo.push(entry);
  const stat = raw ? fs.statSync(registry) : { uid: 314, gid: 902, mode: 432 };
  fs.writeFileSync(registry + ".vidaa-vpn", JSON.stringify(data), {
    mode: stat.mode & 511,
  });
  fs.chownSync(registry + ".vidaa-vpn", stat.uid, stat.gid);
  fs.renameSync(registry + ".vidaa-vpn", registry);
  report.ok = true;
  report.root = 0;
  report.registered = true;
  report.profilesPreserved = !!exists;
  report.vpnRunning = false;
  writeResult();
} catch (error) {
  report.ok = false;
  report.code = /^[A-Z_]+$/.test(error.message)
    ? error.message
    : "INSTALL_FAILED";
  if (fresh) {
    for (const name of functionWrites)
      try {
        fs.unlinkSync(FUNCTIONS + "/" + name);
      } catch (_) {}
    try {
      fs.rmSync(D, { recursive: true });
    } catch (_) {}
  } else if (backupPath) {
    for (const name of changed)
      try {
        if (fs.existsSync(backupPath + "/" + name)) {
          fs.copyFileSync(backupPath + "/" + name, D + "/" + name);
          fs.chmodSync(
            D + "/" + name,
            name === "config.json"
              ? 384
              : ["sing-box", "mieru"].includes(name)
                ? 493
                : 420,
          );
        } else fs.unlinkSync(D + "/" + name);
      } catch (_) {}
    for (const [source, name] of [
      ["api-action.js", "vidaa_vpn_action.js"],
      ["api-status.js", "vidaa_vpn_status.js"],
      ["http-view.js", "fetchresponse_vidaa_vpn_ui.js"],
      ["http-asset.js", "fetchresponse_vidaa_vpn_asset.js"],
    ])
      try {
        fs.copyFileSync(D + "/" + source, FUNCTIONS + "/" + name);
        fs.chownSync(FUNCTIONS + "/" + name, 0, 314);
        fs.chmodSync(FUNCTIONS + "/" + name, 416);
      } catch (_) {}
    if (registryBefore)
      try {
        fs.writeFileSync("/APPS/websdk/Appinfo.json", registryBefore);
      } catch (_) {}
  }
  writeResult();
}
