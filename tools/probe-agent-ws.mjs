// 直连服务: HTTP (/hello, CORS, 私有网络访问头) + 自写 RFC 6455 WebSocket 服务端, 零依赖
import http from "node:http";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import zlib from "node:zlib";
import { WS_MAX_MSG, WS_PING_MS, WS_DEAD_MS, DEFLATE_MIN } from "./probe-agent-const.mjs";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
const FIN = 0x80;
const RSV1 = 0x40;
const TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const DEFLATE_EXT = "permessage-deflate";
const DEFLATE_REPLY = `${DEFLATE_EXT}; server_no_context_takeover; client_no_context_takeover`;
const JSON_TYPE = "application/json; charset=utf-8";

function cors(req) {
  const h = { "Access-Control-Allow-Private-Network": "true", Vary: "Origin" };
  if (req.headers.origin) h["Access-Control-Allow-Origin"] = req.headers.origin;
  return h;
}

function frame(op, payload, rsv1 = false) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = FIN | (rsv1 ? RSV1 : 0) | op;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

export class WsConn extends EventEmitter {
  constructor(socket, deflate, remote) {
    super();
    this.socket = socket;
    this.deflate = deflate;
    this.remote = remote;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.partsLen = 0;
    this.compressed = false;
    this.open = true;
    this.seen = Date.now();
    socket.setNoDelay(true);
    socket.on("data", (d) => this.onData(d));
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
    this.ping = setInterval(() => {
      if (Date.now() - this.seen > WS_DEAD_MS) return this.close(1001, "超时");
      this.raw(frame(OP_PING, Buffer.alloc(0)));
    }, WS_PING_MS);
  }

  raw(buf) {
    if (this.open && !this.socket.destroyed) this.socket.write(buf);
  }

  send(text) {
    let payload = Buffer.from(text);
    if (this.deflate && payload.length >= DEFLATE_MIN) {
      const z = zlib.deflateRawSync(payload, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      return this.raw(frame(OP_TEXT, z.subarray(0, z.length - TAIL.length), true));
    }
    this.raw(frame(OP_TEXT, payload));
  }

  close(code = 1000, reason = "") {
    if (!this.open) return;
    const p = Buffer.alloc(2 + Buffer.byteLength(reason));
    p.writeUInt16BE(code, 0);
    p.write(reason, 2);
    this.raw(frame(OP_CLOSE, p));
    this.socket.end();
    this.finish();
  }

  finish() {
    if (!this.open) return;
    this.open = false;
    clearInterval(this.ping);
    this.socket.destroy();
    this.emit("close");
  }

  onData(d) {
    this.seen = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & FIN) !== 0;
      const rsv1 = (b[0] & RSV1) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        at = 10;
      }
      if (!masked) return this.close(1002, "客户端帧必须加掩码");
      if (len > WS_MAX_MSG) return this.close(1009, "消息过大");
      if (b.length < at + 4 + len) return;
      const mask = b.subarray(at, at + 4);
      const payload = Buffer.from(b.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(at + 4 + len);
      this.onFrame(fin, rsv1, op, payload);
    }
  }

  onFrame(fin, rsv1, op, payload) {
    if (op === OP_PING) return this.raw(frame(OP_PONG, payload));
    if (op === OP_PONG) return;
    if (op === OP_CLOSE) return this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000);
    if (op !== OP_TEXT && op !== OP_BIN && op !== OP_CONT) return this.close(1002, "未知操作码");
    if (op !== OP_CONT) {
      this.parts = [];
      this.partsLen = 0;
      this.compressed = rsv1 && this.deflate;
    }
    this.parts.push(payload);
    this.partsLen += payload.length;
    if (this.partsLen > WS_MAX_MSG) return this.close(1009, "消息过大");
    if (!fin) return;
    let data = Buffer.concat(this.parts);
    this.parts = [];
    if (this.compressed) {
      try {
        data = zlib.inflateRawSync(Buffer.concat([data, TAIL]), { maxOutputLength: WS_MAX_MSG });
      } catch {
        return this.close(1007, "解压失败");
      }
    }
    this.emit("message", data.toString("utf8"));
  }
}

// routes: { "/hello": (req, url) => object }; onSocket(ws) 收到每条升级后的连接
export function startServer({ host, port, routes, onSocket, deflate = true }) {
  const server = http.createServer((req, res) => {
    const h = cors(req);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...h,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] || "content-type",
        "Access-Control-Max-Age": "600",
      });
      return res.end();
    }
    const url = new URL(req.url, "http://x");
    const fn = req.method === "GET" ? routes[url.pathname] : undefined;
    if (!fn) {
      res.writeHead(404, { ...h, "Content-Type": JSON_TYPE });
      return res.end(JSON.stringify({ error: "不存在" }));
    }
    res.writeHead(200, { ...h, "Content-Type": JSON_TYPE, "Cache-Control": "no-store" });
    res.end(JSON.stringify(fn(req, url)));
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    const key = req.headers["sec-websocket-key"];
    if (url.pathname !== "/ws" || !key || String(req.headers.upgrade).toLowerCase() !== "websocket") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    const useDeflate = deflate && String(req.headers["sec-websocket-extensions"] ?? "").includes(DEFLATE_EXT);
    const lines = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`];
    if (useDeflate) lines.push(`Sec-WebSocket-Extensions: ${DEFLATE_REPLY}`);
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    const ws = new WsConn(socket, useDeflate, socket.remoteAddress);
    onSocket(ws, req);
    if (head?.length) ws.onData(head);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
