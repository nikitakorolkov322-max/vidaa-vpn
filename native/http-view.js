"use strict";
const fs = require("fs"),
  D = "/APPS/vidaa-vpn";
const headers = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "https://localhost:9888",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
module.exports = async function (args) {
  const lang = args && args.lang === "en" ? "en" : "ru",
    token = JSON.parse(fs.readFileSync(D + "/auth.json")).token;
  const base =
    "https://localhost:9888/function/basic/fetch/fetchresponse_vidaa_vpn_asset?file=";
  let html = fs.readFileSync(D + "/web/template.html", "utf8");
  const values = {
    LANG: lang,
    TOKEN: token,
    API: "https://localhost:9888/function/basic/fetch/vidaa_vpn_",
    MODE: "native",
    STYLE: base + "style.css",
    CATALOG: base + "i18n/" + lang + ".js",
    APP: base + "app.js",
  };
  for (const [key, value] of Object.entries(values))
    html = html.split("{{" + key + "}}").join(value);
  return {
    status: 200,
    headers: Object.assign({}, headers, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://localhost:9888; img-src 'self' data:",
    }),
    data: html,
  };
};
