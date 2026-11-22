import {
  BUTTON_TASK_PREFIX,
  defaultPriority,
  type ActResult,
  type AgentInfo,
  type AgentStatus,
  type Envelope,
  type Priority,
  type TaskLogEntry,
  type TaskOp,
  type TaskSnapshot,
  type UserAction,
  type UserActionInput,
} from "@hx-aioa/protocol";
import { randomId } from "./auth";
import {
  ACTION_QUEUE_MS,
  CODE_BAD_REQUEST,
  AGENT_ONLINE_MS,
  AGENT_SEEN_PERSIST_MS,
  CODE_CONFLICT,
  CODE_EXPIRED,
  CODE_FORBIDDEN,
  CODE_NEED_CONFIRM,
  CODE_NOT_FOUND,
  ERR_FORBIDDEN,
  ERR_NO_RESOURCE,
  PROGRESS_PERSIST_MS,
  TASK_ENVELOPE_PREFIX,
  TIMER_PROMPT_PREFIX,
} from "./constants";
import { ApiFail } from "./http";
import type { Pipeline } from "./pipeline";
import { type Sockets, attOf, sendFrame } from "./sockets";
import type { TaskStore } from "./taskstore";
import type { Spaces } from "./spaces";
import type { Timers } from "./timers";

type Stored = TaskSnapshot & { keyId?: string; priority?: Priority };
export type Caller = { keyId: string | null; agent?: string; user?: string };

const FINAL = ["done", "failed", "cancelled"];
const SYSTEM_USER = "system";

// Agent 交互层: 注册与在线, 任务生命周期, 用户动作 (幂等, 超时, 二次确认, 离线排队)
export class AgentService {
  private readonly seen = new Map<string, number>();
  private readonly persistedAt = new Map<string, number>();

  constructor(
    private readonly db: TaskStore,
    private readonly sockets: Sockets,
    private readonly pipeline: Pipeline,
    private readonly timers: Timers,
    private readonly spaces: Spaces,
  ) {}

  register(info: AgentInfo, keyId: string | null, mode: "ws" | "http"): void {
    const prev = this.db.agent(info.id);
    if (prev && prev.keyId && keyId && prev.keyId !== keyId) throw new ApiFail(403, CODE_FORBIDDEN, `agent ${info.id} 已被其它 key 注册`);
    const now = Date.now();
    this.seen.set(info.id, now);
    const changed = !prev || JSON.stringify(prev.info) !== JSON.stringify(info) || prev.mode !== mode;
    if (changed || now - prev.seen > AGENT_SEEN_PERSIST_MS) {
      this.db.saveAgent({ info, keyId: keyId ?? prev?.keyId ?? null, seen: now, mode });
    }
    if (changed || mode === "ws") this.broadcastAgents();
  }

  statuses(): AgentStatus[] {
    const live = this.sockets.onlineAgents();
    const now = Date.now();
    return this.db.agents().map((r) => {
      const last = Math.max(this.seen.get(r.info.id) ?? 0, r.seen);
      return { ...r.info, mode: r.mode, lastSeen: last, online: live.has(r.info.id) || (r.mode === "http" && now - last < AGENT_ONLINE_MS) };
    });
  }

  // 按注册时用的 key 分组, 给接入总览
  byKey(): Map<string, AgentStatus[]> {
    const keys = new Map(this.db.agents().map((r) => [r.info.id, r.keyId]));
    const out = new Map<string, AgentStatus[]>();
    for (const s of this.statuses()) {
      const k = keys.get(s.id);
      if (k) out.set(k, [...(out.get(k) ?? []), s]);
    }
    return out;
  }

  broadcastAgents(): void {
    this.sockets.toV1Clients({ t: "agents", agents: this.statuses() });
  }

  // WS 连上并声明身份后, 补发离线期间排队的动作
  hello(ws: WebSocket, info: AgentInfo): void {
    const a = attOf(ws);
    this.register(info, a.keyId ?? null, "ws");
    ws.serializeAttachment({ ...a, agents: [...new Set([...(a.agents ?? []), info.id])] });
    for (const action of this.takePending(info.id)) sendFrame(ws, { t: "act", action });
    this.broadcastAgents();
  }

  takePending(agent: string): UserAction[] {
    const out: UserAction[] = [];
    for (const { state, action } of this.db.unacked(agent, Date.now() - ACTION_QUEUE_MS)) {
      if (state === "queued") this.db.setActionState(action.aid, "delivered");
      out.push(action);
    }
    return out;
  }

  ack(aid: string, caller: Caller): void {
    const row = this.db.action(aid);
    if (!row) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_RESOURCE);
    if (caller.keyId) this.ownAgent(this.db.task(row.action.taskId)?.agent ?? "", caller.keyId);
    this.db.setActionState(aid, "acked");
  }

  private ownAgent(agent: string, keyId: string): void {
    const row = this.db.agent(agent);
    if (row?.keyId && row.keyId !== keyId) throw new ApiFail(403, CODE_FORBIDDEN, ERR_FORBIDDEN);
  }

  private load(id: string): Stored | null {
    return this.db.task(id);
  }

  async op(op: TaskOp, caller: Caller): Promise<TaskSnapshot> {
    const now = Date.now();
    let t = this.load(op.taskId);
    if (t && caller.keyId && t.keyId && t.keyId !== caller.keyId) throw new ApiFail(403, CODE_FORBIDDEN, "该任务属于其它 key");
    if (op.op === "create") {
      const agent = op.agent ?? caller.agent ?? t?.agent;
      if (!agent) throw new ApiFail(400, CODE_BAD_REQUEST, "需要 agent (或先发 agent_hello)");
      if (caller.keyId) this.ownAgent(agent, caller.keyId);
      t = { id: op.taskId, agent, title: op.title ?? op.taskId, state: "running", created: t?.created ?? now, updated: now };
      if (caller.keyId) t.keyId = caller.keyId;
    }
    if (!t) throw new ApiFail(404, CODE_NOT_FOUND, "任务不存在, 先 create");
    if (FINAL.includes(t.state) && op.op !== "create" && op.op !== "say") throw new ApiFail(409, CODE_CONFLICT, "任务已结束");
    for (const k of ["summary", "subject", "step"] as const) if (op[k] !== undefined) t[k] = op[k];
    if (op.priority) t.priority = op.priority;
    if (op.progress !== undefined) t.progress = op.progress;
    t.updated = now;
    const entry: TaskLogEntry = { ts: now, role: "agent", kind: op.op };
    const text = op.text ?? op.result ?? op.error ?? (op.op === "create" ? op.title : undefined);
    if (text) entry.text = text;
    let milestone = true;
    switch (op.op) {
      case "progress":
      case "say":
        milestone = false;
        break;
      case "wait": {
        const p = op.prompt!;
        t.state = "waiting";
        t.prompt = { id: randomId("p_", 4), question: p.question, options: p.options ?? [] };
        if (p.allowText) t.prompt.allowText = true;
        if (p.danger) t.prompt.danger = true;
        if (p.timeoutSec) {
          t.prompt.expires = now + p.timeoutSec * 1000;
          await this.timers.set(TIMER_PROMPT_PREFIX + t.id, t.prompt.expires);
        }
        entry.text = p.question;
        entry.data = t.prompt;
        break;
      }
      case "done":
      case "fail":
        t.state = op.op === "done" ? "done" : "failed";
        if (op.result) t.result = op.result;
        if (op.error) t.error = op.error;
        delete t.prompt;
        await this.timers.clear(TIMER_PROMPT_PREFIX + t.id);
        break;
      default:
        break;
    }
    await this.commit(t, op.op === "progress" ? null : entry, milestone);
    return publicTask(t);
  }

  // 落库策略: 状态变化与对话立刻写; 纯进度最多每 30 秒写一次, 实时帧照发
  private async commit(t: Stored, entry: TaskLogEntry | null, milestone: boolean): Promise<void> {
    const last = this.persistedAt.get(t.id) ?? 0;
    if (milestone || entry || t.updated - last > PROGRESS_PERSIST_MS) {
      this.db.saveTask(t);
      this.persistedAt.set(t.id, t.updated);
    }
    if (entry) {
      this.db.log(t.id, entry);
      this.sockets.toV1Clients({ t: "task_log", taskId: t.id, entry });
    }
    const snap = publicTask(t);
    this.sockets.toV1Clients({ t: "task", task: snap });
    if (milestone) await this.pipeline.ingest(this.envelopeOf(t), null);
  }

  private envelopeOf(t: Stored): Envelope {
    const agent = this.db.agent(t.agent)?.info;
    const snap = publicTask(t);
    const ev = {
      id: TASK_ENVELOPE_PREFIX + t.id,
      seq: 0,
      ts: t.updated,
      kind: "task",
      source: { id: `agent:${t.agent}`, name: agent?.name ?? t.agent, icon: agent?.icon ?? "bot", type: "agent" },
      priority: t.state === "waiting" ? "need_me" : (t.priority ?? defaultPriority("task", snap)),
      data: snap,
    } as Envelope;
    if (t.subject) ev.subject = t.subject;
    if (FINAL.includes(t.state)) ev.resolved = true;
    return ev;
  }

  async act(input: UserActionInput, user: string): Promise<ActResult> {
    if (this.db.action(input.aid)) return { aid: input.aid, state: "duplicate" };
    if (input.taskId.startsWith(BUTTON_TASK_PREFIX)) return this.press(input, user);
    const t = this.load(input.taskId);
    if (!t) throw new ApiFail(404, CODE_NOT_FOUND, "任务不存在");
    if (FINAL.includes(t.state)) throw new ApiFail(409, CODE_CONFLICT, "任务已结束");
    const now = Date.now();
    const prompt = t.prompt && !t.prompt.expired ? t.prompt : undefined;
    const answering = input.kind === "approve" || input.kind === "reject" || (input.kind === "reply" && prompt);
    const decisive = input.kind === "approve" || input.kind === "reject";
    if (decisive && t.prompt?.expired) throw new ApiFail(410, CODE_EXPIRED, "确认已超时");
    if (decisive && !prompt) throw new ApiFail(409, CODE_CONFLICT, "当前没有等待确认的问题");
    if (answering && prompt) {
      if (prompt.expires && prompt.expires < now) throw new ApiFail(410, CODE_EXPIRED, "确认已超时");
      const opt = prompt.options.find((o) => o.id === input.option);
      if (input.option && !opt) throw new ApiFail(400, CODE_BAD_REQUEST, "option 不在可选项中");
      if (input.kind === "reply" && !prompt.allowText && prompt.options.length) throw new ApiFail(400, CODE_BAD_REQUEST, "该问题不接受文字回复");
      const danger = prompt.danger || opt?.style === "danger";
      if (danger && input.kind !== "reject" && !input.confirm) throw new ApiFail(409, CODE_NEED_CONFIRM, "危险动作需要二次确认");
    }
    const action: UserAction = { ...input, ts: now, user };
    if (answering && prompt) action.promptId = prompt.id;
    const state = this.dispatch(t.agent, action);
    const entry: TaskLogEntry = { ts: now, role: "user", kind: input.kind, data: { aid: input.aid, option: input.option } };
    if (input.text) entry.text = input.text;
    t.updated = now;
    let milestone = false;
    if (answering && prompt) {
      delete t.prompt;
      t.state = "running";
      milestone = true;
      await this.timers.clear(TIMER_PROMPT_PREFIX + t.id);
    }
    if (input.kind === "cancel") {
      t.state = "cancelled";
      delete t.prompt;
      milestone = true;
    }
    await this.commit(t, entry, milestone);
    return { aid: input.aid, state };
  }

  // 工作台按钮: 按声明找到 Agent 与命令, 每次按下重开同一个任务, 便于在任务里看到执行记录
  private async press(input: UserActionInput, user: string): Promise<ActResult> {
    const b = await this.spaces.button(input.taskId);
    if (!b) throw new ApiFail(404, CODE_NOT_FOUND, "按钮不存在");
    if (b.danger && !input.confirm) throw new ApiFail(409, CODE_NEED_CONFIRM, "危险动作需要二次确认");
    const now = Date.now();
    const prev = this.load(input.taskId);
    const t: Stored = { id: input.taskId, agent: b.agent, title: b.command, state: "running", created: prev?.created ?? now, updated: now };
    const action: UserAction = { ...input, kind: "reply", text: b.args ? `${b.command} ${JSON.stringify(b.args)}` : b.command, ts: now, user };
    const state = this.dispatch(b.agent, action);
    await this.commit(t, { ts: now, role: "user", kind: "button", text: b.command, data: { aid: input.aid, args: b.args } }, true);
    return { aid: input.aid, state };
  }

  private dispatch(agent: string, action: UserAction): "queued" | "delivered" {
    const live = this.sockets.agentSockets(agent);
    let sent = false;
    for (const ws of live) sent = sendFrame(ws, { t: "act", action }) || sent;
    const state = sent ? "delivered" : "queued";
    this.db.saveAction(agent, action, state);
    this.db.pruneActions(Date.now() - 2 * ACTION_QUEUE_MS);
    return state;
  }

  // 确认超时: 标记过期, 任务回到运行, 并替用户给 Agent 投递一次 "拒绝 (超时)"
  async expire(taskId: string): Promise<void> {
    const t = this.load(taskId);
    const p = t?.prompt;
    if (!t || !p || p.expired || t.state !== "waiting" || (p.expires ?? 0) > Date.now()) return;
    p.expired = true;
    t.state = "running";
    t.updated = Date.now();
    const action: UserAction = { aid: `timeout:${p.id}`, taskId, kind: "reject", ts: t.updated, user: SYSTEM_USER, promptId: p.id, timeout: true };
    this.dispatch(t.agent, action);
    await this.commit(t, { ts: t.updated, role: "system", kind: "timeout", text: "确认超时, 视为拒绝" }, true);
  }

  list(state: string | null, limit: number): TaskSnapshot[] {
    return this.db.tasks(state, limit).map(publicTask);
  }

  detail(id: string, limit: number): { task: TaskSnapshot; log: TaskLogEntry[] } | null {
    const t = this.load(id);
    return t ? { task: publicTask(t), log: this.db.logs(id, limit) } : null;
  }
}

function publicTask(t: Stored): TaskSnapshot {
  const { keyId: _k, priority: _p, ...rest } = t;
  return rest;
}
