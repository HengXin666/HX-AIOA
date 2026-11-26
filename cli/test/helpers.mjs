// 测试用: 本地假服务端 (HTTP + 最小 WebSocket) 与跑命令行子进程
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = fileURLToPath(new URL("../src/main.mjs", import.meta.url));
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const SHORT_LEN = 126;

/**
 * handler(req, url, body) 返回 { status, json, text, headers } (undefined 为 404)。
 * ws: true 时接受长连, server.push(frame) 推一帧; 否则拒绝, 命令行退回定时拉取。
 */
export async function fakeServer(handler, { ws = false } = {}) {
  const reqs = [];
  const sockets = [];
  const srv = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, "http://x");
    const rec = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: body ? JSON.parse(body) : undefined };
    reqs.push(rec);
    const r = (await handler(rec)) ?? { status: 404, json: { error: "没有" } };
    res.writeHead(r.status ?? 200, { "Content-Type": r.text === undefined ? "application/json" : "text/plain", ...(r.headers ?? {}) });
    res.end(r.text ?? JSON.stringify(r.json ?? {}));
  });
  srv.on("upgrade", (req, socket) => {
    reqs.push({ method: "WS", path: new URL(req.url, "http://x").pathname, query: Object.fromEntries(new URL(req.url, "http://x").searchParams) });
    if (!ws) return socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + WS_GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("error", () => {});
    // 回应关闭帧, 命令行关长连时不用等超时
    socket.on("data", (buf) => (buf[0] & 0x0f) === 8 && socket.end(Buffer.from([0x88, 0])));
    sockets.push(socket);
    srv.emit("ws", socket);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const push = (frame) => {
    const data = Buffer.from(JSON.stringify(frame));
    const head = data.length < SHORT_LEN ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, SHORT_LEN, data.length >> 8, data.length & 0xff]);
    for (const s of sockets) s.write(Buffer.concat([head, data]));
  };
  const close = () =>
    new Promise((r) => {
      for (const s of sockets) s.destroy();
      srv.close(r);
      srv.closeAllConnections?.();
    });
  return { base, reqs, push, close, srv };
}

/** 新的数据目录; cfg 写进 config.json。 */
export function home(cfg = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hxaioa-test-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
  return dir;
}

export const readJsonFile = (path) => JSON.parse(readFileSync(path, "utf8"));

/** 跑命令行, 返回 { code, stdout, stderr }。 */
export function run(dir, server, args, env = {}) {
  return new Promise((resolve) => {
    const e = { ...process.env, HXAIOA_HOME: dir, AIOA_SERVER: server, AIOA_KEY: "k-test", HXAIOA_NO_SELF_UPDATE: "1", ...env };
    execFile(process.execPath, [MAIN, ...args], { env: e, timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

export const ev = (seq, text, type = "user", channel = "g1") => ({ seq, ts: 1_700_000_000_000 + seq, channel, kind: "event", source: { id: `${type}:${seq}`, name: type === "user" ? "主人" : "别人", type }, data: { title: text } });
