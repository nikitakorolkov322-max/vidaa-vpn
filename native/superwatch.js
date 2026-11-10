"use strict";
const net = require("net");
module.exports = function request(payload) {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0),
      complete = false;
    const socket = net.createConnection("/var/run/superwatch_socket", () => {
      const body = Buffer.from(payload),
        prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(body.length);
      socket.write(Buffer.concat([prefix, body]));
    });
    function finish(error, value) {
      if (complete) return;
      complete = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    }
    socket.setTimeout(5000);
    socket.on("data", (part) => {
      bytes = Buffer.concat([bytes, part]);
      if (bytes.length < 4) return;
      const length = bytes.readUInt32LE(0);
      if (length > 65536) return finish(Error("INVALID_REPLY"));
      if (bytes.length >= length + 4)
        finish(null, bytes.subarray(4, length + 4).toString());
    });
    socket.on("error", (error) => finish(error));
    socket.on("timeout", () => finish(Error("SERVICE_TIMEOUT")));
    socket.on("end", () => {
      if (!complete) finish(Error("INCOMPLETE_REPLY"));
    });
  });
};
