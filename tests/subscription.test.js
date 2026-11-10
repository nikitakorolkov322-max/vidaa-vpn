"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  vm = require("vm"),
  path = require("path");
const sub = require("../native/subscription"),
  network = require("../native/network");
const id = "00000000-0000-0000-0000-000000000001";
const good =
  "vless://" +
  id +
  "@server.example:443?security=tls&sni=server.example#Example";
test("raw and Base64 subscriptions produce identical synthetic profiles", () => {
  assert.deepEqual(
    sub.parse(good),
    sub.parse(Buffer.from(good).toString("base64")),
  );
});
test("deduplication, unknown schemes and malformed lines are handled without retaining input", () => {
  const r = sub.parse(
    good + "\n" + good + "\nnot a url\nunknown://server.example",
  );
  assert.equal(r.profiles.length, 1);
  assert.equal(r.skipped, 2);
});
test("plaintext VLESS and disabled certificate verification are rejected", () => {
  assert.throws(() => sub.parse("vless://" + id + "@server.example:443#NoTLS"));
  assert.throws(() =>
    sub.parse(
      JSON.stringify({
        outbounds: [
          {
            type: "anytls",
            tag: "Synthetic",
            server: "server.example",
            server_port: 443,
            password: "TEST_ONLY",
            tls: { enabled: true, insecure: true },
          },
        ],
      }),
    ),
  );
});
test("JSON cannot inject local key files or routing overrides", () => {
  const p = sub.normalize({
    type: "anytls",
    tag: "Synthetic",
    server: "server.example",
    server_port: 443,
    password: "TEST_ONLY",
    detour: "direct",
    bind_interface: "unsafe",
    tls: {
      enabled: true,
      server_name: "server.example",
      certificate_path: "/never-read",
      key_path: "/never-read",
      client_certificate_path: "/never-read",
    },
  });
  assert.equal(p.outbound.detour, undefined);
  assert.equal(p.outbound.bind_interface, undefined);
  assert.equal(p.outbound.tls.key_path, undefined);
  assert.equal(p.outbound.tls.client_certificate_path, undefined);
});
test("invalid port and malformed Reality parameters are rejected", () => {
  assert.throws(() => sub.parse(good.replace(":443", ":70000")));
  assert.throws(() =>
    sub.parse(
      good.replace("security=tls", "security=reality&pbk=invalid&sid=zz"),
    ),
  );
});
test("URI percent encoding and Naive memory setting", () => {
  const p = sub.parse(
    "naive+https://test:TEST%5FONLY@server.example:443#Synthetic",
  ).profiles[0];
  assert.equal(p.outbound.password, "TEST_ONLY");
  assert.equal(p.outbound.stream_receive_window, "4 MB");
});
test("Mieru remains loopback-only and secrets stay out of sing-box SOCKS outbound", () => {
  const p = sub.parse(
    "mierus://test:TEST_ONLY@server.example?port=443&protocol=TCP#Synthetic",
  ).profiles[0];
  const t = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../native/template.json")),
    ),
    c = sub.config(t, p, "/APPS/vidaa-vpn");
  assert.equal(c.mieru.socks5ListenLAN, false);
  assert.equal(c.mieru.rpcPort, 0);
  assert.equal(c.config.outbounds[0].server, "127.0.0.1");
  assert(!JSON.stringify(c.config).includes("TEST_ONLY"));
});
test("virtual subnet automatically avoids connected networks", () => {
  const n = {
    eth0: [
      {
        family: "IPv4",
        internal: false,
        address: "172.30.1.2",
        netmask: "255.255.0.0",
      },
    ],
  };
  assert.equal(network.choose(n), "10.255.254.1/30");
  n.eth1 = [
    {
      family: "IPv4",
      internal: false,
      address: "10.1.1.2",
      netmask: "255.0.0.0",
    },
  ];
  assert.equal(network.choose(n), "198.18.0.1/30");
});
test("both language dictionaries have identical keys and no hard-coded session keys", () => {
  const load = (language) => {
    const context = { window: {} };
    vm.runInNewContext(
      fs.readFileSync(
        path.join(__dirname, "../web/i18n/" + language + ".js"),
        "utf8",
      ),
      context,
    );
    return context.window.VPN_TEXT;
  };
  assert.deepEqual(
    Object.keys(load("ru")).sort(),
    Object.keys(load("en")).sort(),
  );
  for (const language of ["ru", "en"]) {
    const h = fs.readFileSync(
      path.join(__dirname, "../web/" + language + "/index.html"),
      "utf8",
    );
    assert(h.includes('content="demo"'));
    assert(h.includes('name="vidaa-vpn-token" content=""'));
    assert(!h.includes("{{"));
  }
});
test("asset endpoint rejects traversal before touching the filesystem", async () => {
  const serve = require("../native/http-asset");
  for (const file of [
    "../auth.json",
    "/etc/passwd",
    "i18n/../../auth.json",
    "__proto__",
  ])
    assert.equal((await serve({ file })).status, 404);
});
test("privileged installer refuses non-root execution before touching app data", () => {
  const writes = [],
    plan = {
      version: "test",
      operation: "install",
      hashes: {},
      productionFiles: [],
    };
  const fakeFs = {
    readFileSync: (p) => {
      if (p.endsWith("/plan.json")) return JSON.stringify(plan);
      throw Error("UNEXPECTED_READ");
    },
    writeFileSync: (p, data) => writes.push([p, JSON.parse(data)]),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../native/install-root.js"), "utf8"),
    {
      require: (name) =>
        name === "fs" ? fakeFs : name === "child_process" ? {} : require(name),
      __filename: "/test-stage/root.js",
      process: { getuid: () => 314 },
    },
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "/test-stage/result.json");
  assert.equal(writes[0][1].code, "ROOT_REQUIRED");
});
test("removal cannot take ownership of another application directory", () => {
  const writes = [],
    plan = {
      version: "test",
      operation: "remove",
      hashes: {},
      productionFiles: [],
    };
  const fakeFs = {
    readFileSync: (p) =>
      JSON.stringify(
        p.endsWith("/plan.json") ? plan : { owner: "unrelated-application" },
      ),
    existsSync: () => true,
    writeFileSync: (p, data) => writes.push([p, JSON.parse(data)]),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../native/install-root.js"), "utf8"),
    {
      require: (name) =>
        name === "fs"
          ? fakeFs
          : name === "child_process"
            ? { execFileSync: () => "aarch64\n" }
            : require(name),
      __filename: "/test-stage/root.js",
      process: { getuid: () => 0 },
    },
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].code, "DIRECTORY_COLLISION");
});
