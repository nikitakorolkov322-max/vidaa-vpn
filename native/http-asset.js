"use strict";
const fs = require("fs"),
  D = "/APPS/vidaa-vpn/web";
const types = {
  "app.js": "application/javascript; charset=utf-8",
  "style.css": "text/css; charset=utf-8",
  "i18n/ru.js": "application/javascript; charset=utf-8",
  "i18n/en.js": "application/javascript; charset=utf-8",
  "logo.svg": "image/svg+xml",
};
module.exports = async function (args) {
  const file = args && args.file;
  if (!Object.prototype.hasOwnProperty.call(types, file))
    return {
      status: 404,
      headers: { "Content-Type": "text/plain" },
      data: "Not found",
    };
  return {
    status: 200,
    headers: {
      "Content-Type": types[file],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "https://localhost:9888",
    },
    data: fs.readFileSync(D + "/" + file, "utf8"),
  };
};
