// 探针 Agent GUI 的本地文件: 主机密钥, 设备, 实例, 设置, 规则, 会话索引与原始 ACP 日志
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import {
  HOME_PARTS, SESSIONS_DIR, PRESETS, DEFAULT_SETTINGS, DEFAULT_RULES, WINDOW_TURNS, WINDOW_BYTES, SINCE_MAX_BYTES,
  CUT_CONTENT_BYTES, M, U,
} from "./probe-agent-const.mjs";

const UTF8 = "utf8";
const JWK = "jwk";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const NL = 10;
const TAIL_READ = 64 * 1024;

export function agentHome() {
  return process.env.AIOA_AGENT_HOME || path.join(os.homedir(), ...HOME_PARTS);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, UTF8));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: FILE_MODE });
  fs.renameSync(tmp, file);
}

// 预设首次写入时, 本机装了 codex / dsh 就让适配器用本机的 (免去下载私有运行时)
function onPath(name, real) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const f = dir && path.join(dir, name);
    if (f && fs.existsSync(f)) return real ? fs.realpathSync(f) : f;
  }
  return undefined;
}

function presets() {
  const local = { codex: ["CODEX_PATH", onPath("codex")], dsh: ["DSH_PATH", onPath("dsh", true)] };
  return PRESETS.map((p) => (local[p.id]?.[1] ? { ...p, env: { [local[p.id][0]]: local[p.id][1] } } : { ...p }));
}

const pubOnly = (jwk) => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });

export function openStore(home = agentHome()) {
  fs.mkdirSync(path.join(home, SESSIONS_DIR), { recursive: true, mode: DIR_MODE });
  const file = (name) => path.join(home, name);
  const init = (name, value) => {
    const v = readJson(file(name), undefined);
    if (v !== undefined) return v;
    writeJson(file(name), value);
    return structuredClone(value);
  };
  let key = readJson(file("host-key.json"), undefined);
  if (!key?.priv) {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const priv = privateKey.export({ format: JWK });
    key = { priv, pub: pubOnly(priv), created: Date.now() };
    writeJson(file("host-key.json"), key);
  }
  const store = {
    home,
    hostPub: key.pub,
    hostPriv: createPrivateKey({ key: key.priv, format: JWK }),
    devices: init("devices.json", []),
    instances: init("instances.json", presets()),
    settings: { ...DEFAULT_SETTINGS, ...init("settings.json", DEFAULT_SETTINGS) },
    rules: init("rules.json", DEFAULT_RULES),
    calib: readJson(file("calib.json"), {}),
    sessions: readJson(path.join(home, SESSIONS_DIR, "index.json"), { sessions: [] }).sessions ?? [],
    save(name) {
      if (name === "index") return writeJson(path.join(home, SESSIONS_DIR, "index.json"), { sessions: store.sessions });
      writeJson(file(`${name}.json`), store[name]);
    },
    log(sid) {
      return new SessionLog(path.join(home, SESSIONS_DIR), sid);
    },
  };
  return store;
}

export function devicePublicKey(jwk) {
  return createPublicKey({ key: pubOnly(jwk), format: JWK });
}

// 窗口与补帧给出的工具大段原始输出先去掉, 展开时用 tool/output 取
function trimEntry(e) {
  const up = e.m?.method === M.update ? e.m.params?.update : undefined;
  if (!up || (up.sessionUpdate !== U.tool && up.sessionUpdate !== U.toolUpdate) || !Array.isArray(up.content)) return e;
  const big = (c) => c?.type === "content" && JSON.stringify(c).length > CUT_CONTENT_BYTES;
  if (!up.content.some(big)) return e;
  const update = { ...up, content: up.content.filter((c) => !big(c)) };
  return { seq: e.seq, m: { ...e.m, params: { ...e.m.params, update } }, cut: true };
}

export class SessionLog {
  constructor(dir, sid) {
    this.file = path.join(dir, `${sid}.jsonl`);
    this.turnsFile = path.join(dir, `${sid}.turns.json`);
    this.turns = readJson(this.turnsFile, []);
    this.size = 0;
    this.seq = 0;
    this.tools = new Map();
    try {
      this.size = fs.statSync(this.file).size;
      this.seq = this.lastSeq();
    } catch {}
    this.fd = fs.openSync(this.file, "a", FILE_MODE);
  }

  lastSeq() {
    const len = Math.min(TAIL_READ, this.size);
    const lines = this.readRaw(this.size - len, this.size).toString(UTF8).trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]).seq;
      } catch {}
    }
    return 0;
  }

  // 一轮从客户端发出的 session/prompt 开始
  markTurn() {
    this.turns.push({ seq: this.seq + 1, off: this.size });
    writeJson(this.turnsFile, this.turns);
  }

  append(dir, m) {
    const entry = { seq: ++this.seq, at: Date.now(), dir, m };
    const buf = Buffer.from(`${JSON.stringify(entry)}\n`);
    const up = m?.method === M.update ? m.params?.update : undefined;
    if (up?.toolCallId && Array.isArray(up.content)) this.tools.set(up.toolCallId, this.size);
    fs.writeSync(this.fd, buf);
    this.size += buf.length;
    return entry;
  }

  readRaw(from, to) {
    if (to <= from) return Buffer.alloc(0);
    const buf = Buffer.alloc(to - from);
    const fd = fs.openSync(this.file, "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, from);
    } finally {
      fs.closeSync(fd);
    }
    return buf;
  }

  // 解析 [from, to) 的完整行; 返回 [{ e, off }]
  read(from, to) {
    const buf = this.readRaw(from, to);
    const out = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== NL) continue;
      try {
        out.push({ e: JSON.parse(buf.subarray(start, i).toString(UTF8)), off: from + start });
      } catch {}
      start = i + 1;
    }
    return out;
  }

  bounds() {
    const b = this.turns.length && this.turns[0].off === 0 ? [] : [{ seq: 1, off: 0 }];
    return b.concat(this.turns);
  }

  offsetOf(seq) {
    if (seq > this.seq) return this.size;
    const b = this.bounds();
    let k = 0;
    while (k + 1 < b.length && b[k + 1].seq <= seq) k++;
    const end = b[k + 1]?.off ?? this.size;
    const hit = this.read(b[k].off, end).find((x) => x.e.seq >= seq);
    return hit ? hit.off : end;
  }

  // 结束于 endOff 的回放: 往前最多 turns 轮, 不超过 WINDOW_BYTES
  slice(endOff, turns) {
    const b = this.bounds().filter((x) => x.off < endOff);
    let i = Math.max(0, b.length - turns);
    while (i < b.length - 1 && endOff - b[i].off > WINDOW_BYTES) i++;
    let start = b[i]?.off ?? 0;
    let partial = false;
    if (endOff - start > WINDOW_BYTES) {
      start = endOff - WINDOW_BYTES;
      partial = true;
    }
    let rows = this.read(start, endOff);
    if (partial && rows.length && rows[0].off === start) rows = rows.slice(1);
    const items = rows.map((r) => trimEntry(r.e));
    return { from: items[0]?.seq ?? this.seq + 1, to: items.at(-1)?.seq ?? this.seq, more: (rows[0]?.off ?? endOff) > 0, items };
  }

  window() {
    return this.slice(this.size, WINDOW_TURNS);
  }

  page(before, limit = WINDOW_TURNS) {
    return this.slice(this.offsetOf(before), Math.max(1, Math.min(limit, 20)));
  }

  // 断线补帧; 太多就返回 null, 由调用方改发最近窗口
  since(seq) {
    const off = this.offsetOf(seq + 1);
    if (this.size - off > SINCE_MAX_BYTES) return null;
    const items = this.read(off, this.size).map((r) => trimEntry(r.e));
    return { from: seq + 1, to: this.seq, more: false, items };
  }

  toolContent(toolCallId) {
    let off = this.tools.get(toolCallId);
    if (off === undefined) {
      for (const r of this.read(0, this.size)) {
        const up = r.e.m?.params?.update;
        if (up?.toolCallId === toolCallId && Array.isArray(up.content)) off = r.off;
      }
    }
    if (off === undefined) return null;
    for (let len = 4096; ; len *= 4) {
      const end = Math.min(this.size, off + len);
      const row = this.read(off, end)[0];
      if (row) return row.e.m.params.update.content;
      if (end === this.size) return null;
    }
  }

  close() {
    try {
      fs.closeSync(this.fd);
    } catch {}
  }

  remove() {
    this.close();
    for (const f of [this.file, this.turnsFile]) fs.rmSync(f, { force: true });
  }
}
