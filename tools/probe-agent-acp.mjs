// ACP 客户端的进程层: stdio 上的 JSON-RPC (每行一条), 以及 Agent 发来的 fs/* 与 terminal/* 请求
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { JSONRPC, STDERR_TAIL, KILL_GRACE_MS, TERM_OUTPUT_MAX, TERM_KEEP, DIR_IN, DIR_OUT } from "./probe-agent-const.mjs";

const UTF8 = "utf8";
const PIPE = "pipe";
const SIGKILL = "SIGKILL";

export const RPC_ERR = { notFound: -32601, invalid: -32602, internal: -32603 };

// 子进程环境: 去掉探针自己的凭据
export function childEnv(extra) {
  const env = { ...process.env, ...(extra ?? {}) };
  delete env.AIOA_TOKEN;
  return env;
}

export class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export class AcpProc extends EventEmitter {
  // onRecord(dir, m) 记日志; 收到的消息以 "message" 事件交给会话层
  constructor({ cmd, args, env, cwd, onRecord }) {
    super();
    this.onRecord = onRecord;
    this.pending = new Map();
    this.n = 0;
    this.stderr = "";
    this.exited = false;
    this.child = spawn(cmd, args ?? [], { cwd, env: childEnv(env), stdio: [PIPE, PIPE, PIPE], detached: true });
    let line = "";
    this.child.stdout.setEncoding(UTF8);
    this.child.stdout.on("data", (d) => {
      line += d;
      let i;
      while ((i = line.indexOf("\n")) >= 0) {
        const s = line.slice(0, i).trim();
        line = line.slice(i + 1);
        if (s) this.onLine(s);
      }
    });
    this.child.stderr.setEncoding(UTF8);
    this.child.stderr.on("data", (d) => {
      this.stderr = (this.stderr + d).slice(-STDERR_TAIL);
    });
    this.child.stdin.on("error", () => {});
    this.child.on("error", (e) => this.onExit(null, null, `启动失败: ${e.message}`));
    this.child.on("exit", (code, sig) => this.onExit(code, sig));
  }

  onLine(s) {
    let m;
    try {
      m = JSON.parse(s);
    } catch {
      return;
    }
    if (m.id !== undefined && m.method === undefined && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      this.onRecord(DIR_IN, m);
      if (m.error) p.reject(new RpcError(m.error.code, m.error.message, m.error.data));
      else p.resolve(m.result);
      return;
    }
    this.emit("message", m);
  }

  onExit(code, sig, why) {
    if (this.exited) return;
    this.exited = true;
    const err = why || `Agent 进程退出 (${sig ?? code})${this.stderr ? `: ${this.stderr.trim().split("\n").slice(-3).join(" | ")}` : ""}`;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new RpcError(RPC_ERR.internal, err));
    }
    this.pending.clear();
    this.emit("exit", { code, sig, err });
  }

  write(m, record = true) {
    if (record) this.onRecord(DIR_OUT, m);
    if (!this.exited) this.child.stdin.write(`${JSON.stringify(m)}\n`);
  }

  // 探针自己发起的请求, id 用 h 前缀, 与客户端请求 (p 前缀) 不冲突
  request(method, params, timeoutMs) {
    const id = `h${++this.n}`;
    return new Promise((resolve, reject) => {
      if (this.exited) return reject(new RpcError(RPC_ERR.internal, "Agent 进程已退出"));
      const timer = timeoutMs ? setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(RPC_ERR.internal, `${method} 超时`));
      }, timeoutMs) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: JSONRPC, id, method, params });
    });
  }

  notify(method, params) {
    this.write({ jsonrpc: JSONRPC, method, params });
  }

  respond(id, result) {
    this.write({ jsonrpc: JSONRPC, id, result: result ?? null });
  }

  respondError(id, code, message) {
    this.write({ jsonrpc: JSONRPC, id, error: { code, message } });
  }

  kill() {
    if (this.exited) return;
    const pid = this.child.pid;
    const sig = (s) => {
      try {
        process.kill(-pid, s);
      } catch {
        try {
          this.child.kill(s);
        } catch {}
      }
    };
    sig("SIGTERM");
    setTimeout(() => !this.exited && sig(SIGKILL), KILL_GRACE_MS).unref();
  }
}

// fs 只允许会话 cwd 下 (按真实路径比较, 防符号链接逃逸)
export function insideCwd(cwd, p) {
  const root = fs.realpathSync(cwd);
  const abs = path.resolve(root, p ?? ".");
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    let dir = path.dirname(abs);
    const rest = [path.basename(abs)];
    while (!fs.existsSync(dir) && dir !== path.dirname(dir)) {
      rest.unshift(path.basename(dir));
      dir = path.dirname(dir);
    }
    real = path.join(fs.realpathSync(dir), ...rest);
  }
  if (real !== root && !real.startsWith(root + path.sep)) throw new RpcError(RPC_ERR.invalid, `路径不在会话目录内: ${p}`);
  return real;
}

// Agent 发给客户端的 fs/* 与 terminal/* 请求, 由探针直接实现
export class ClientSide {
  constructor(cwd) {
    this.cwd = cwd;
    this.terms = new Map();
    this.done = new Map();
    this.n = 0;
  }

  handles(method) {
    return method.startsWith("fs/") || method.startsWith("terminal/");
  }

  async call(method, p) {
    switch (method) {
      case "fs/read_text_file": {
        const text = fs.readFileSync(insideCwd(this.cwd, p.path), UTF8);
        if (!p.line && !p.limit) return { content: text };
        const lines = text.split("\n");
        const from = Math.max(0, (p.line ?? 1) - 1);
        return { content: lines.slice(from, p.limit ? from + p.limit : undefined).join("\n") };
      }
      case "fs/write_text_file": {
        const file = insideCwd(this.cwd, p.path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, p.content ?? "");
        return {};
      }
      case "terminal/create":
        return this.create(p);
      case "terminal/output": {
        const t = this.term(p.terminalId);
        return { output: t.out, truncated: t.truncated, exitStatus: t.exit ?? null };
      }
      case "terminal/wait_for_exit": {
        const t = this.term(p.terminalId);
        return t.exit ?? (await t.wait);
      }
      case "terminal/kill":
        this.term(p.terminalId).child.kill("SIGTERM");
        return {};
      case "terminal/release": {
        const t = this.term(p.terminalId);
        if (!t.exit) t.child.kill(SIGKILL);
        this.terms.delete(p.terminalId);
        this.done.set(p.terminalId, t);
        if (this.done.size > TERM_KEEP) this.done.delete(this.done.keys().next().value);
        return {};
      }
      default:
        throw new RpcError(RPC_ERR.notFound, `不支持的方法: ${method}`);
    }
  }

  term(id) {
    const t = this.terms.get(id);
    if (!t) throw new RpcError(RPC_ERR.invalid, `终端不存在: ${id}`);
    return t;
  }

  create(p) {
    const id = `t${++this.n}`;
    const env = childEnv(Object.fromEntries((p.env ?? []).map((e) => [e.name, e.value])));
    const cwd = p.cwd || this.cwd;
    const args = p.args ?? [];
    const child = spawn(p.command, args, { cwd, env, shell: args.length === 0, stdio: ["ignore", PIPE, PIPE] });
    const limit = Math.min(p.outputByteLimit ?? TERM_OUTPUT_MAX, TERM_OUTPUT_MAX);
    const t = { child, out: "", truncated: false, exit: null };
    const add = (d) => {
      t.out += d;
      if (Buffer.byteLength(t.out) > limit) {
        t.truncated = true;
        const b = Buffer.from(t.out);
        t.out = b.subarray(b.length - limit).toString(UTF8).replace(/^\uFFFD+/, "");
      }
    };
    child.stdout.setEncoding(UTF8);
    child.stderr.setEncoding(UTF8);
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    t.wait = new Promise((resolve) => {
      const end = (code, signal) => {
        if (t.exit) return;
        t.exit = { exitCode: code ?? null, signal: signal ?? null };
        resolve(t.exit);
      };
      child.on("exit", end);
      child.on("error", (e) => {
        add(`${e.message}\n`);
        end(127, null);
      });
    });
    this.terms.set(id, t);
    return { terminalId: id };
  }

  output(id) {
    const t = this.terms.get(id) ?? this.done.get(id);
    return t ? { output: t.out, truncated: t.truncated, exitStatus: t.exit } : null;
  }

  killAll() {
    for (const t of this.terms.values()) if (!t.exit) t.child.kill(SIGKILL);
    this.terms.clear();
  }
}
