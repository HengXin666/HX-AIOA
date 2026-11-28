// 一个 Agent 会话: 子进程, ACP 握手, 消息路由与日志, 权限请求, 轮跟踪与统计
import { AcpProc, ClientSide, RpcError, RPC_ERR } from "./probe-agent-acp.mjs";
import { buildCard, promptText, Stats } from "./probe-agent-card.mjs";
import { gitBranch } from "./probe-agent-hx.mjs";
import {
  M, U, ST, JSONRPC, DIR_IN, DIR_OUT, CLIENT_INFO, INIT_TIMEOUT_MS, NEW_TIMEOUT_MS, EDIT_KINDS, OUTCOME_SELECTED,
  OUTCOME_CANCELLED, KIND_REJECT_ONCE, BY_AGENT, BY_DESKTOP, USAGE_LIMIT, USAGE_LIMIT_RE, AUTH_REQUIRED, ACP_AUTH_CODE, AUTH_RE,
  AUTH_TIMEOUT_MS,
} from "./probe-agent-const.mjs";

const TITLE_MAX = 60;
const PROTOCOL_VERSION = 1;
const CLIENT_CAPS = { fs: { readTextFile: true, writeTextFile: true }, terminal: true };

const errText = (e) => (USAGE_LIMIT_RE.test(e?.message ?? "") ? `${USAGE_LIMIT}: ${e.message}` : e?.message ?? String(e));
const isAuthErr = (e) => e?.code === ACP_AUTH_CODE || AUTH_RE.test(e?.message ?? "");

// session/new (或恢复) 时 Agent 要求先登录: methods 是 initialize 回的 authMethods 原样; 进程留着等 agent/authenticate
export class AuthRequired extends Error {
  constructor(message, methods) {
    super(message);
    this.code = AUTH_REQUIRED;
    this.methods = methods;
  }
}

export class Session {
  // core: 主模块提供的广播与 Hub 接口; info: 持久化的 SessionInfo (+ acpSid, model)
  constructor(core, info, log) {
    this.core = core;
    this.info = info;
    this.log = log;
    this.proc = null;
    this.side = null;
    this.perms = new Map();
    this.fromClients = new Map();
    this.agentReqs = new Set();
    this.tools = new Map();
    this.turn = null;
    this.queued = null;
    this.loading = false;
    this.pn = 0;
    this.rn = 0;
    this.branch = undefined;
    this.init = null;
    this.authWait = null;
    this.stats = new Stats(core.store.calib, () => `${this.info.instance}/${this.info.model ?? ""}`);
  }

  get id() {
    return this.info.id;
  }

  live() {
    return !!this.proc && !this.proc.exited;
  }

  record(dir, m, own) {
    const entry = this.log.append(dir, m);
    this.core.record(this, entry, own);
    return entry;
  }

  set(patch) {
    Object.assign(this.info, patch, { updated: Date.now() });
    this.core.info(this);
  }

  async start(inst, { resume = false, mode, model } = {}) {
    this.authWait = null;
    this.set({ state: ST.starting, err: undefined });
    this.side = new ClientSide(this.info.cwd);
    const proc = new AcpProc({ cmd: inst.cmd, args: inst.args, env: inst.env, cwd: this.info.cwd, onRecord: (d, m) => this.record(d, m) });
    this.proc = proc;
    proc.on("message", (m) => this.onAgent(m));
    proc.on("exit", ({ err }) => this.onExit(proc, err));
    gitBranch(this.info.cwd).then((b) => (this.branch = b));
    try {
      this.init = await proc.request(M.init, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPS, clientInfo: CLIENT_INFO }, INIT_TIMEOUT_MS);
    } catch (e) {
      throw this.fail(proc, e);
    }
    return this.open(inst, { resume, mode, model });
  }

  // initialize 之后: 新建 / 恢复 ACP 会话; 要求登录时抛 AuthRequired 并留着进程
  async open(inst, { resume = false, mode, model } = {}) {
    const proc = this.proc;
    const init = this.init ?? {};
    try {
      const caps = init?.agentCapabilities ?? {};
      const base = { cwd: this.info.cwd, mcpServers: [] };
      let res;
      if (!resume) {
        res = await proc.request(M.newSession, base, NEW_TIMEOUT_MS);
        this.info.acpSid = res.sessionId;
      } else if (caps.sessionCapabilities?.resume) {
        res = await proc.request(M.resume, { ...base, sessionId: this.info.acpSid }, NEW_TIMEOUT_MS);
      } else if (caps.loadSession) {
        this.loading = true;
        res = await proc.request(M.load, { ...base, sessionId: this.info.acpSid }, NEW_TIMEOUT_MS).finally(() => (this.loading = false));
      } else {
        throw new Error("这个 Agent 不支持恢复会话 (loadSession)");
      }
      const cap = { agent: caps, agentInfo: init?.agentInfo, authMethods: init?.authMethods, protocolVersion: init?.protocolVersion, configOptions: res?.configOptions };
      this.info.caps = cap;
      if (res?.modes) this.info.modes = res.modes;
      if (res?.models) this.info.models = res.models;
      await this.applyDefaults(mode ?? inst.mode, model ?? inst.model);
      this.set({ state: ST.idle });
      return this.info;
    } catch (e) {
      const methods = Array.isArray(init.authMethods) ? init.authMethods : [];
      if (methods.length && isAuthErr(e) && proc && !proc.exited) {
        this.authWait = { inst, opts: { resume, mode, model } };
        const msg = e?.message || "Agent 需要先登录";
        this.set({ state: ST.error, err: `${AUTH_REQUIRED}: ${msg}` });
        throw new AuthRequired(msg, methods);
      }
      throw this.fail(proc, e);
    }
  }

  fail(proc, e) {
    const msg = errText(e);
    if (proc && !proc.exited) proc.kill();
    this.set({ state: ST.error, err: msg });
    return new Error(msg);
  }

  // 在等登录的进程上调 ACP authenticate, 成功后重试 session/new (或恢复)
  async authenticate(methodId) {
    const w = this.authWait;
    if (!w || !this.live()) throw new Error("没有等登录的 Agent 进程, 请重新新建会话");
    if (!(this.init?.authMethods ?? []).some((m) => m?.id === methodId)) throw new Error(`没有这个登录方式: ${methodId}`);
    this.set({ state: ST.starting, err: undefined });
    try {
      await this.proc.request(M.auth, { methodId }, AUTH_TIMEOUT_MS);
    } catch (e) {
      // 登录本身失败: 进程留着, 可以换个方式再试
      this.set({ state: ST.error, err: `${AUTH_REQUIRED}: ${errText(e)}` });
      throw new AuthRequired(errText(e), this.init.authMethods);
    }
    this.authWait = null;
    return this.open(w.inst, w.opts);
  }

  async applyDefaults(mode, model) {
    const sid = this.info.acpSid;
    if (mode && this.info.modes?.availableModes?.some((m) => m.id === mode) && this.info.modes.currentModeId !== mode) {
      await this.proc.request(M.setMode, { sessionId: sid, modeId: mode }).then(() => (this.info.modes.currentModeId = mode)).catch(() => {});
    }
    if (!model) return;
    this.info.model = model;
    const opt = this.info.caps.configOptions?.find((o) => o.category === "model");
    if (opt) {
      const r = await this.proc.request(M.setConfig, { sessionId: sid, configId: opt.id, value: model }).catch(() => null);
      if (r?.configOptions) this.info.caps.configOptions = r.configOptions;
    } else if (this.info.models) {
      await this.proc.request(M.setModel, { sessionId: sid, modelId: model }).catch(() => {});
    }
  }

  onExit(proc, err) {
    if (this.proc !== proc) return;
    this.side?.killAll();
    this.finishPerms();
    for (const [pid, c] of this.fromClients) {
      this.record(DIR_IN, { jsonrpc: JSONRPC, id: pid, error: { code: RPC_ERR.internal, message: err } }, c);
    }
    this.fromClients.clear();
    this.turn = null;
    if (this.info.state !== ST.closed) this.set({ state: ST.error, err, pending: 0 });
  }

  // 客户端经 acp_out 发来的 ACP 消息: sessionId 换成真实的, id 重映射
  fromClient(conn, m) {
    if (!m || typeof m !== "object") throw new Error("acp_out 需要 m");
    if (m.method === undefined && m.id !== undefined) {
      if (!this.agentReqs.has(m.id)) return;
      this.agentReqs.delete(m.id);
      return this.proc?.write({ jsonrpc: JSONRPC, id: m.id, ...(m.error ? { error: m.error } : { result: m.result ?? null }) });
    }
    if (!this.live()) {
      if (m.id !== undefined) conn.push({ t: "acp", sid: this.id, m: { jsonrpc: JSONRPC, id: m.id, error: { code: RPC_ERR.internal, message: "Agent 未运行, 先恢复会话" } } });
      return;
    }
    const params = m.params && typeof m.params === "object" ? { ...m.params } : {};
    if (m.method.startsWith("session/")) params.sessionId = this.info.acpSid;
    if (m.method === M.cancel) this.cancelPerms();
    if (m.id === undefined) return this.proc.write({ jsonrpc: JSONRPC, method: m.method, params });
    const pid = `p${++this.pn}`;
    const own = { conn, cid: m.id };
    this.fromClients.set(pid, { ...own, method: m.method, params });
    if (m.method === M.prompt) this.beginTurn(promptText(params.prompt));
    const out = { jsonrpc: JSONRPC, id: pid, method: m.method, params };
    this.proc.write(out, false);
    this.record(DIR_OUT, out, own);
  }

  beginTurn(goal) {
    this.log.markTurn();
    this.turn = { goal, last: "", lastTool: false, changed: new Set(), cancelling: false };
    this.stats.resetTurn();
    const patch = { state: ST.running, err: undefined };
    if (this.info.titleAuto && goal) {
      patch.title = goal.split("\n")[0].slice(0, TITLE_MAX);
      patch.titleAuto = false;
    }
    this.set(patch);
  }

  // 探针自己发的 prompt (拒绝并说明)
  prompt(text) {
    const params = { sessionId: this.info.acpSid, prompt: [{ type: "text", text }] };
    this.beginTurn(text);
    this.proc.request(M.prompt, params).then((r) => this.endTurn(r), (e) => this.endTurn(null, e));
  }

  endTurn(result, error) {
    const usage = result?.usage;
    if (this.stats.endTurn(usage)) this.core.calib();
    this.core.stats(this);
    this.turn = null;
    const patch = { state: this.perms.size ? ST.waiting : ST.idle };
    if (error) Object.assign(patch, { state: ST.error, err: errText(error) });
    this.set(patch);
    if (this.queued && this.live()) {
      const text = this.queued;
      this.queued = null;
      this.prompt(text);
    }
  }

  onAgent(m) {
    if (m.method === undefined) {
      const c = this.fromClients.get(m.id);
      if (!c) return this.record(DIR_IN, m);
      this.fromClients.delete(m.id);
      this.record(DIR_IN, m, c);
      if (c.method === M.prompt) this.endTurn(m.result, m.error ? new RpcError(m.error.code, m.error.message) : null);
      if (c.method === M.setMode && !m.error && this.info.modes) this.info.modes.currentModeId = c.params.modeId;
      if (m.result?.configOptions && this.info.caps) this.info.caps.configOptions = m.result.configOptions;
      const modelOpt = this.info.caps?.configOptions?.find((o) => o.category === "model");
      if (c.method === M.setConfig && !m.error && modelOpt && c.params.configId === modelOpt.id) this.info.model = c.params.value;
      if (c.method === M.setMode || c.method === M.setConfig) this.set({});
      return;
    }
    if (m.id === undefined) {
      if (this.loading && m.method === M.update) return;
      this.record(DIR_IN, m);
      if (m.method === M.update) this.onUpdate(m.params?.update ?? {});
      return;
    }
    this.record(DIR_IN, m);
    if (m.method === M.perm) return this.onPerm(m);
    if (this.side?.handles(m.method)) {
      this.side.call(m.method, m.params ?? {}).then(
        (r) => this.proc?.respond(m.id, r),
        (e) => this.proc?.respondError(m.id, e.code ?? RPC_ERR.internal, e.message),
      );
      return;
    }
    // 探针不认识的请求 (扩展方法等) 交给附着的客户端回答
    this.agentReqs.add(m.id);
  }

  onUpdate(u) {
    const turn = this.turn;
    switch (u.sessionUpdate) {
      case U.message:
      case U.thought: {
        const text = u.content?.type === "text" ? u.content.text : "";
        if (!text) return;
        this.stats.chunk(text);
        this.core.stats(this);
        if (u.sessionUpdate === U.message && turn) {
          turn.last = turn.lastTool ? text : turn.last + text;
          turn.lastTool = false;
        }
        return;
      }
      case U.tool:
      case U.toolUpdate: {
        const prev = this.tools.get(u.toolCallId) ?? {};
        const t = { ...prev, ...u };
        this.tools.set(u.toolCallId, t);
        if (turn) {
          turn.lastTool = true;
          if (EDIT_KINDS.has(t.kind) && t.status === "completed") for (const l of t.locations ?? []) l?.path && turn.changed.add(l.path);
        }
        return;
      }
      case U.usage:
        this.stats.usage(u);
        this.core.stats(this);
        if (this.stats.ctx?.[1]) this.set({ ctx: Math.round((this.stats.ctx[0] / this.stats.ctx[1]) * 1000) / 1000 });
        return;
      case U.mode:
        if (this.info.modes) this.info.modes.currentModeId = u.currentModeId;
        return this.set({});
      case U.config:
        if (this.info.caps) this.info.caps.configOptions = u.configOptions;
        return this.set({});
      case U.info:
        if (typeof u.title === "string" && this.info.titleAuto) this.set({ title: u.title.slice(0, TITLE_MAX) });
        return;
      default:
    }
  }

  onPerm(m) {
    const rid = `r${Date.now().toString(36)}${++this.rn}`;
    const params = m.params ?? {};
    const tool = this.tools.get(params.toolCall?.toolCallId);
    const card = buildCard({ host: this.core.host, sess: this.info, rid, params, tool, turn: this.turn, rules: this.core.store.rules, branch: this.branch });
    const perm = { rid, aid: m.id, card, options: params.options ?? [], done: null, timer: null };
    this.perms.set(rid, perm);
    this.set({ state: ST.waiting, pending: this.perms.size });
    this.core.permReq(this, perm);
  }

  // 先答先得: 已答过返回 false
  answer(rid, option, text, by) {
    const perm = this.perms.get(rid);
    if (!perm) return false;
    let outcome;
    if (option === null || option === undefined) {
      const rej = perm.options.find((o) => o.kind === KIND_REJECT_ONCE);
      outcome = rej ? { outcome: OUTCOME_SELECTED, optionId: rej.optionId } : { outcome: OUTCOME_CANCELLED };
    } else {
      if (!perm.options.some((o) => o.optionId === option)) throw new Error(`没有这个选项: ${option}`);
      outcome = { outcome: OUTCOME_SELECTED, optionId: option };
    }
    this.proc?.respond(perm.aid, { outcome });
    this.donePerm(perm, by, outcome.optionId ?? null);
    if (text && this.live()) {
      if (this.turn) {
        this.queued = text;
        this.proc.notify(M.cancel, { sessionId: this.info.acpSid });
        this.cancelPerms();
      } else this.prompt(text);
    }
    return true;
  }

  donePerm(perm, by, option) {
    clearTimeout(perm.timer);
    perm.done = by;
    this.perms.delete(perm.rid);
    this.core.permDone(this, perm, by, option);
    const st = this.info.state === ST.waiting && !this.perms.size ? (this.turn ? ST.running : ST.idle) : this.info.state;
    this.set({ pending: this.perms.size, state: st });
  }

  // 客户端发了 session/cancel: ACP 要求客户端把未决请求都答 cancelled
  cancelPerms() {
    for (const perm of [...this.perms.values()]) {
      this.proc?.respond(perm.aid, { outcome: { outcome: OUTCOME_CANCELLED } });
      this.donePerm(perm, BY_DESKTOP, null);
    }
  }

  // 结束路径 (进程退出, 关闭): 未决请求以 cancelled 收尾
  finishPerms() {
    for (const perm of [...this.perms.values()]) {
      if (this.live()) this.proc.respond(perm.aid, { outcome: { outcome: OUTCOME_CANCELLED } });
      this.donePerm(perm, BY_AGENT, null);
    }
  }

  close() {
    this.finishPerms();
    this.side?.killAll();
    const p = this.proc;
    this.proc = null;
    p?.kill();
    this.turn = null;
    this.set({ state: ST.closed, pending: 0 });
  }

  toolOutput(toolCallId) {
    const content = this.tools.get(toolCallId)?.content ?? this.log.toolContent(toolCallId) ?? [];
    return content.map((c) => (c?.type === "terminal" ? { ...c, ...(this.side?.output(c.terminalId) ?? {}) } : c));
  }

  remove() {
    if (this.live()) this.close();
    this.log.remove();
  }
}
