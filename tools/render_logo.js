"use strict";
const fs = require("fs"),
  path = require("path"),
  { Resvg } = require("@resvg/resvg-js"),
  root = path.resolve(__dirname, ".."),
  source = fs.readFileSync(path.join(root, "web/logo.svg"), "utf8");
for (const size of [96, 400])
  fs.writeFileSync(
    path.join(root, "web/logo-" + size + ".png"),
    new Resvg(source, { fitTo: { mode: "width", value: size } })
      .render()
      .asPng(),
  );
