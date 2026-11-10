"use strict";
const fs = require("fs"),
  D = "/APPS/vidaa-vpn";
module.exports = async function (args) {
  try {
    if (
      !args ||
      args.token !== JSON.parse(fs.readFileSync(D + "/auth.json")).token
    )
      return { error: "UNAUTHORIZED" };
    const action = args.action;
    if (
      !["start", "stop", "select", "update", "probe", "security"].includes(
        action,
      )
    )
      return { error: "INVALID_ACTION" };
    const sw = require(D + "/superwatch.js"),
      since = Date.now();
    let capsule = action;
    if (["select", "update"].includes(action)) {
      const request = { op: action };
      if (action === "select") {
        if (!/^[a-f0-9]{20}$/.test(String(args.id)))
          return { error: "SERVER_NOT_FOUND" };
        request.id = args.id;
      } else if (args.url) {
        if (
          typeof args.url !== "string" ||
          args.url.length > 8192 ||
          new URL(args.url).protocol !== "https:"
        )
          return { error: "HTTPS_REQUIRED" };
        request.url = args.url;
      }
      const p = D + "/requests/action.json";
      fs.writeFileSync(p + ".tmp", JSON.stringify(request), { mode: 384 });
      fs.renameSync(p + ".tmp", p);
      capsule = "apply";
    }
    if (["probe", "security"].includes(action)) {
      const name = action === "probe" ? "probes.json" : "security.json";
      try {
        const state = JSON.parse(fs.readFileSync(D + "/" + name));
        if (
          state.running &&
          Date.now() - (state.updated || state.started) < 25000
        )
          return { since: state.started, alreadyRunning: true };
      } catch (_) {}
    }
    const id = "local.vidaa.vpn." + capsule;
    await sw("94:83:94;" + id);
    const response = await sw(
      "93:82:93;" + D + "/" + capsule + ".ipk;" + id + ";",
    );
    if (response !== "93:0") return { error: "INSTALLER_DENIED" };
    return { since };
  } catch (_) {
    return { error: "ACTION_FAILED" };
  }
};
