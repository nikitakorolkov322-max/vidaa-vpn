"use strict";
const crypto = require("crypto");
const supported = new Set(["vless", "anytls", "naive", "mieru"]);
function text(value, max = 120) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, max);
}
function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}
function uri(line) {
  const u = new URL(line),
    q = u.searchParams,
    scheme = u.protocol.slice(0, -1);
  const o = {
    type: scheme,
    tag: decode(u.hash.slice(1)),
    server: u.hostname.replace(/^\[|\]$/g, ""),
    server_port: Number(u.port || 443),
  };
  if (scheme === "vless") {
    o.uuid = decode(u.username);
    o.flow = q.get("flow") || undefined;
    const security = q.get("security");
    if (!["tls", "reality"].includes(security)) throw Error("TLS_REQUIRED");
    o.tls = { enabled: true, server_name: q.get("sni") || o.server };
    if (q.get("fp")) o.tls.utls = { enabled: true, fingerprint: q.get("fp") };
    if (security === "reality")
      o.tls.reality = {
        enabled: true,
        public_key: q.get("pbk"),
        short_id: q.get("sid") || "",
      };
    const transport = q.get("type") || "tcp";
    if (transport === "ws")
      o.transport = {
        type: "ws",
        path: q.get("path") || "/",
        headers: q.get("host") ? { Host: q.get("host") } : undefined,
      };
    else if (transport === "grpc")
      o.transport = { type: "grpc", service_name: q.get("serviceName") || "" };
    else if (transport !== "tcp") throw Error("TRANSPORT_UNSUPPORTED");
  } else if (scheme === "anytls") {
    o.password = decode(u.username);
    o.tls = { enabled: true, server_name: q.get("sni") || o.server };
  } else if (["naive+https", "naive+quic"].includes(scheme)) {
    o.type = "naive";
    o.username = decode(u.username);
    o.password = decode(u.password);
    o.quic = scheme.endsWith("quic");
    o.tls = { enabled: true, server_name: q.get("sni") || o.server };
  } else if (scheme === "mierus") {
    const ports = q.getAll("port"),
      protocols = q.getAll("protocol");
    if (ports.length !== 1 || !/^\d+$/.test(ports[0]) || protocols.length > 1)
      throw Error("MIERU_PORT_RANGE_UNSUPPORTED");
    o.type = "mieru";
    o.username = decode(u.username);
    o.password = decode(u.password);
    o.server_port = Number(ports[0]);
    o.transport = (protocols[0] || "TCP").toUpperCase();
    o.multiplexing = q.get("multiplexing") || "MULTIPLEXING_LOW";
  } else return null;
  return o;
}
function tls(source, type) {
  if (!source || !source.enabled || source.insecure)
    throw Error("TLS_REQUIRED");
  const out = {
    enabled: true,
    server_name: text(source.server_name, 253),
    insecure: false,
  };
  if (type === "vless" && source.utls && source.utls.enabled) {
    if (
      ![
        "chrome",
        "firefox",
        "safari",
        "ios",
        "android",
        "edge",
        "random",
        "randomized",
      ].includes(source.utls.fingerprint)
    )
      throw Error("FINGERPRINT_UNSUPPORTED");
    out.utls = { enabled: true, fingerprint: source.utls.fingerprint };
  }
  if (type === "vless" && source.reality && source.reality.enabled) {
    const key = source.reality.public_key,
      id = source.reality.short_id || "";
    if (
      typeof key !== "string" ||
      !/^[A-Za-z0-9_-]{43}=?$/.test(key) ||
      Buffer.from(key.replace(/-/g, "+").replace(/_/g, "/"), "base64")
        .length !== 32 ||
      !/^(?:[0-9a-fA-F]{2}){0,8}$/.test(id)
    )
      throw Error("REALITY_INVALID");
    out.reality = { enabled: true, public_key: key, short_id: id };
  }
  // Untrusted subscriptions cannot select local keys, CA paths, or filesystem resources.
  return out;
}
function normalize(source) {
  if (!source || !supported.has(source.type)) return null;
  if (
    typeof source.server !== "string" ||
    !source.server ||
    source.server.length > 253 ||
    /[\s\x00-\x1f]/.test(source.server) ||
    !Number.isInteger(source.server_port) ||
    source.server_port < 1 ||
    source.server_port > 65535
  )
    throw Error("SERVER_INVALID");
  const o = {
    type: source.type,
    server: source.server,
    server_port: source.server_port,
  };
  if (o.type === "vless") {
    if (
      !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(
        source.uuid || "",
      )
    )
      throw Error("UUID_INVALID");
    o.uuid = source.uuid;
    if (source.flow && source.flow !== "xtls-rprx-vision")
      throw Error("FLOW_UNSUPPORTED");
    if (source.flow) o.flow = source.flow;
    if (source.transport) {
      const tr = source.transport;
      if (tr.type === "ws")
        o.transport = {
          type: "ws",
          path: text(tr.path || "/", 2048),
          headers:
            tr.headers && typeof tr.headers.Host === "string"
              ? { Host: text(tr.headers.Host, 253) }
              : undefined,
        };
      else if (tr.type === "grpc")
        o.transport = {
          type: "grpc",
          service_name: text(tr.service_name, 200),
        };
      else throw Error("TRANSPORT_UNSUPPORTED");
    }
  } else {
    if (
      typeof source.password !== "string" ||
      !source.password ||
      source.password.length > 4096
    )
      throw Error("PASSWORD_INVALID");
    o.password = source.password;
    if (["naive", "mieru"].includes(o.type)) {
      if (typeof source.username !== "string" || source.username.length > 256)
        throw Error("USERNAME_INVALID");
      o.username = source.username;
    }
  }
  if (o.type !== "mieru") o.tls = tls(source.tls, o.type);
  if (o.type === "naive") {
    o.quic = !!source.quic;
    o.stream_receive_window = "4 MB";
  }
  if (o.type === "mieru") {
    o.transport = String(source.transport || "TCP").toUpperCase();
    if (!["TCP", "UDP"].includes(o.transport))
      throw Error("TRANSPORT_UNSUPPORTED");
    const level = String(
      source.multiplexing || "MULTIPLEXING_LOW",
    ).toUpperCase();
    o.multiplexing = level.startsWith("MULTIPLEXING_")
      ? level
      : "MULTIPLEXING_" + level;
    if (
      ![
        "MULTIPLEXING_OFF",
        "MULTIPLEXING_LOW",
        "MULTIPLEXING_MIDDLE",
        "MULTIPLEXING_HIGH",
      ].includes(o.multiplexing)
    )
      throw Error("MULTIPLEXING_INVALID");
  }
  return {
    id: crypto
      .createHash("sha256")
      .update(JSON.stringify(o))
      .digest("hex")
      .slice(0, 20),
    title: text(source.tag) || o.type,
    protocol: o.type,
    outbound: o,
  };
}
function parse(input) {
  if (Buffer.byteLength(input) > 4 * 1024 * 1024)
    throw Error("SUBSCRIPTION_TOO_LARGE");
  let data;
  try {
    data = JSON.parse(input);
  } catch (_) {}
  let raw,
    skipped = 0;
  if (data) {
    raw = Array.isArray(data) ? data : data.outbounds;
    if (!Array.isArray(raw)) throw Error("FORMAT_UNSUPPORTED");
  } else {
    let source = input.trim();
    if (!source.includes("://"))
      source = Buffer.from(
        source.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8");
    const lines = source
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (lines.length > 1000) throw Error("TOO_MANY_SERVERS");
    raw = [];
    for (const line of lines) {
      try {
        const o = uri(line);
        if (o) raw.push(o);
        else skipped++;
      } catch (_) {
        skipped++;
      }
    }
  }
  const profiles = [],
    ids = new Set();
  for (const o of raw) {
    try {
      const p = normalize(o);
      if (p && !ids.has(p.id)) {
        profiles.push(p);
        ids.add(p.id);
      } else if (!p) skipped++;
    } catch (_) {
      skipped++;
    }
  }
  if (!profiles.length) throw Error("NO_SUPPORTED_SERVERS");
  if (profiles.length > 200) throw Error("TOO_MANY_SERVERS");
  return { profiles, skipped };
}
function config(template, profile, dir) {
  const c = JSON.parse(JSON.stringify(template)),
    o = JSON.parse(JSON.stringify(profile.outbound));
  o.tag = "vpn";
  o.domain_resolver = { server: "bootstrap", strategy: "ipv4_only" };
  if (o.tls) o.tls.certificate_path = dir + "/ca-bundle.pem";
  let mieru = null,
    outbound = o;
  if (o.type === "mieru") {
    mieru = {
      profiles: [
        {
          profileName: "vpn",
          user: { name: o.username, password: o.password },
          servers: [
            {
              domainName: o.server,
              portBindings: [{ port: o.server_port, protocol: o.transport }],
            },
          ],
          mtu: 1400,
          multiplexing: { level: o.multiplexing },
        },
      ],
      activeProfile: "vpn",
      rpcPort: 0,
      socks5Port: 18988,
      socks5ListenLAN: false,
      loggingLevel: "ERROR",
    };
    outbound = {
      type: "socks",
      tag: "vpn",
      server: "127.0.0.1",
      server_port: 18988,
      version: "5",
    };
  }
  c.outbounds = [outbound, { type: "direct", tag: "direct" }];
  for (const s of c.dns.servers)
    if (s.tls) s.tls.certificate_path = dir + "/ca-bundle.pem";
  return { config: c, mieru };
}
module.exports = { parse, normalize, uri, config };
