"use strict";
function number(ip) {
  const parts = String(ip).split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    throw Error("INVALID_IPV4");
  return parts.reduce((v, n) => (v * 256 + n) >>> 0, 0);
}
function choose(interfaces) {
  const occupied = Object.values(interfaces)
    .flat()
    .filter(
      (row) => (row.family === "IPv4" || row.family === 4) && !row.internal,
    );
  for (const candidate of [
    "172.30.254.1/30",
    "10.255.254.1/30",
    "198.18.0.1/30",
  ]) {
    const target = number(candidate.split("/")[0]);
    if (
      !occupied.some((row) => {
        const mask = number(row.netmask);
        return (number(row.address) & mask) === (target & mask);
      })
    )
      return candidate;
  }
  throw Error("NETWORK_ADDRESS_COLLISION");
}
module.exports = { choose };
