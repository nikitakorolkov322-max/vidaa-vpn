"use strict";
const fs = require("fs"),
  D = "/APPS/vidaa-vpn";
function read(n) {
  try {
    return JSON.parse(fs.readFileSync(D + "/" + n, "utf8"));
  } catch (_) {
    return null;
  }
}
function processInfo(file, bin) {
  try {
    const m = read(file),
      stat = fs.readFileSync("/proc/" + m.pid + "/stat", "utf8"),
      start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
      cmd = fs.readFileSync("/proc/" + m.pid + "/cmdline", "utf8").split("\0");
    if (start !== m.start || cmd[0] !== bin) return null;
    const status = fs.readFileSync("/proc/" + m.pid + "/status", "utf8"),
      rss = status.match(/^VmRSS:\s+(\d+)/m);
    return { started: m.startedAt || null, rss: rss ? Number(rss[1]) : 0 };
  } catch (_) {
    return null;
  }
}
function counter(n) {
  try {
    return Number(
      fs.readFileSync("/sys/class/net/vvpn0/statistics/" + n, "utf8"),
    );
  } catch (_) {
    return null;
  }
}
module.exports = async function (args) {
  const auth = read("auth.json");
  if (!auth || !args || args.token !== auth.token)
    return { error: "UNAUTHORIZED" };
  const main = processInfo("pid.json", D + "/sing-box"),
    side = processInfo("mieru-pid.json", D + "/mieru"),
    state = {
      running: !!main,
      memoryMiB: Math.round(
        ((main ? main.rss : 0) + (side ? side.rss : 0)) / 1024,
      ),
      settings: read("public.json") || {
        profiles: [],
        selected: null,
        subscriptionHost: "",
      },
      result: read("result.json"),
      session: {
        started: main ? main.started : null,
        download: main ? counter("rx_bytes") : null,
        upload: main ? counter("tx_bytes") : null,
      },
    };
  for (const name of ["probes", "security"]) {
    const value = read(name + ".json");
    if (
      value &&
      value.running &&
      Date.now() - (value.updated || value.started) > 30000
    ) {
      value.running = false;
      value.error = "CHECK_TIMEOUT";
    }
    state[name] = value;
  }
  return state;
};
