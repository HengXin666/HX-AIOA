import {
  AG_PAIR_TIMEOUT_MS,
  ANDROID_DEVICE_PREFIX,
  type AgAnswerFrame,
  type AgCard,
  type AgHost,
  type AgHostsFrame,
  type AgInFrame,
  type AgIndexItem,
  type AgPairDevice,
  type AgPairedFrame,
  type AgUnreqBy,
  type AgUnreqFrame,
  type HostCard,
  type WebPushPayload,
} from "@hx-aioa/protocol";
import { randomId } from "./auth";
import { AG_OPEN, AgentGuiStore } from "./agent-gui-store";
import { CODE_FORBIDDEN, ERR_FORBIDDEN } from "./constants";
import { type MetricRouter, isProbe } from "./metrics";
import type { WebPush } from "./webpush/service";
import { type Attachment, attOf, sendFrame } from "./sockets";

const PAIR_PREFIX = "p";
const CODE_AG = "agent_gui";
const ERR_OFFLINE = "主机不在线, 稍后再试";
const ERR_OPTION = "选项不在这个请求里";
const ERR_GONE = "主机已断开";
const PUSH_TITLE_SUFFIX = " 等你批准";
const AGENT_FALLBACK = "Agent";
const GUI_HASH = "/#/agent/gui/";
// 索引说会话已没有待批请求时, 只收掉比这更早收到的卡片, 免得索引帧与请求帧交错误收
const RECONCILE_GRACE_MS = 10_000;

export type AgDeps = {
  // 非子号的全部连接 (探针 + 主人的客户端)
  all: () => WebSocket[];
  // 只发给主人的 v1 客户端
  toClients: (frame: unknown) => void;
  store: AgentGuiStore;
  // Web Push (没配或没有订阅时什么都不做)
  push: (p: WebPushPayload, urgent: boolean) => Promise<void>;
  // 主机卡片 (在线的来自探针连接, 离线的来自最后快照)
  hostCards: () => HostCard[];
};

type Pending = { subject: string; done: (f: AgPairedFrame | null) => void };

const AG_FRAME_PREFIX = "ag_";
export const isAgFrame = (f: { t: string }): f is AgInFrame => f.t.startsWith(AG_FRAME_PREFIX);
export const isAgentProbe = (a: Attachment) => isProbe(a) && a.agent === true && !!a.host?.info.agent;
const projectOf = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;

/** 推送正文: 标题 "<Agent> 等你批准", 正文是工具标题与项目; 点开到这个会话。 */
export function pushOf(card: AgCard): WebPushPayload {
  const what = card.tool.title || card.tool.kind;
  const p: WebPushPayload = {
    title: (card.agent || AGENT_FALLBACK) + PUSH_TITLE_SUFFIX,
    body: card.cwd ? `${what} · ${projectOf(card.cwd)}` : what,
    seq: 0,
    tag: `ag-${card.host}-${card.rid}`,
    url: `${GUI_HASH}${encodeURIComponent(card.host)}/${encodeURIComponent(card.sid)}`,
  };
  if (card.quiet) p.silent = true;
  return p;
}

/** Agent GUI 经 Hub 的部分: 会话索引 (只在内存), 待审批卡片 (先答先得), 配对转发。 */
export class AgentGui {
  // 主体 -> 会话索引; DO 被回收就丢, 探针下次状态变化或重连时重报
  private readonly index = new Map<string, AgIndexItem[]>();
  private readonly pairs = new Map<string, Pending>();

  constructor(private readonly d: AgDeps) {}

  get store(): AgentGuiStore {
    return this.d.store;
  }

  probeFor(subject: string): WebSocket | undefined {
    return this.d.all().find((ws) => {
      const a = attOf(ws);
      return isAgentProbe(a) && a.host?.subject === subject;
    });
  }

  hosts(): AgHost[] {
    return this.d
      .hostCards()
      .filter((h) => h.info.agent)
      .map((h) => ({ subject: h.subject, online: h.online, routes: h.info.agent?.routes ?? [], sessions: h.online ? (this.index.get(h.subject) ?? []) : [] }));
  }

  hostsFrame(): AgHostsFrame {
    return { t: "ag_hosts", hosts: this.hosts() };
  }

  broadcastHosts(): void {
    this.d.toClients(this.hostsFrame());
  }

  /** 连接上来的 ag_* 帧: 探针认 key 带 probe:agent 且声明了 agent; 客户端只认主人的连接。 */
  async handle(ws: WebSocket, att: Attachment, f: AgInFrame): Promise<void> {
    if (f.t === "ag_answer") {
      if (att.role !== "client" || att.member) return this.deny(ws, f.aid);
      return this.answer(ws, att, f);
    }
    if (!isAgentProbe(att)) return this.deny(ws);
    const subject = att.host!.subject;
    switch (f.t) {
      case "ag_index":
        this.index.set(subject, f.sessions);
        this.reconcile(subject, f.sessions);
        return this.broadcastHosts();
      case "ag_req":
        return this.request({ ...f.card, host: subject });
      case "ag_unreq":
        return this.close(subject, f.sid, f.rid, f.by);
      case "ag_paired": {
        const p = this.pairs.get(f.pid);
        if (p && p.subject === subject) p.done(f);
        return;
      }
    }
  }

  private deny(ws: WebSocket, aid?: string): void {
    sendFrame(ws, aid ? { t: "err", code: CODE_FORBIDDEN, text: ERR_FORBIDDEN, aid } : { t: "err", code: CODE_FORBIDDEN, text: ERR_FORBIDDEN });
  }

  private async request(card: AgCard, now = Date.now()): Promise<void> {
    const r = this.d.store.put(card, now);
    if (r.kind === "done") return;
    this.d.toClients({ t: "ag_req", card });
    // 新请求: 有人在电脑前看着就静默推, 否则正常推; 重发且 quiet 变假: 补一次正常推送
    const loud = !card.quiet;
    if (r.kind === "update" && (!loud || r.loudBefore)) return;
    if (loud) this.d.store.markLoud(card.host, card.rid);
    await this.d.push(pushOf(card), loud).catch((e) => console.error("Agent GUI 推送失败:", e));
  }

  private close(host: string, sid: string, rid: string, by: AgUnreqBy, now = Date.now()): void {
    if (!this.d.store.done(host, rid, by, now)) return;
    const f: AgUnreqFrame = { t: "ag_unreq", host, sid, rid, by };
    this.d.toClients(f);
  }

  // 探针重连 / 重启后, 已经没有待批请求的会话里残留的卡片收掉
  private reconcile(host: string, sessions: AgIndexItem[], now = Date.now()): void {
    const live = new Map(sessions.map((s) => [s.id, s]));
    for (const row of this.d.store.openOf(host)) {
      const s = live.get(row.sid);
      if (row.at > now - RECONCILE_GRACE_MS) continue;
      if (!s || s.pending === 0 || s.state === "closed") this.close(host, row.sid, row.rid, "agent", now);
    }
  }

  private async answer(ws: WebSocket, att: Attachment, f: AgAnswerFrame): Promise<void> {
    const row = this.d.store.get(f.host, f.rid);
    // 已经有人答了 / 撤回了 (或根本没有): 告诉这一端收掉卡片
    if (!row || row.state !== AG_OPEN || row.sid !== f.sid) {
      sendFrame(ws, { t: "ag_unreq", host: f.host, sid: f.sid, rid: f.rid, by: (row?.by as AgUnreqBy | null) ?? "agent" } satisfies AgUnreqFrame);
      return;
    }
    const card = JSON.parse(row.card) as AgCard;
    if (f.option !== null && !card.options.some((o) => o.optionId === f.option)) return void sendFrame(ws, { t: "err", code: CODE_AG, text: ERR_OPTION, aid: f.aid });
    const probe = this.probeFor(f.host);
    if (!probe) return void sendFrame(ws, { t: "err", code: CODE_AG, text: ERR_OFFLINE, aid: f.aid });
    const by: AgUnreqBy = att.device.startsWith(ANDROID_DEVICE_PREFIX) ? "phone" : "web";
    if (!this.d.store.done(f.host, f.rid, by)) {
      sendFrame(ws, { t: "ag_unreq", host: f.host, sid: f.sid, rid: f.rid, by: (this.d.store.get(f.host, f.rid)?.by as AgUnreqBy) ?? "agent" } satisfies AgUnreqFrame);
      return;
    }
    sendFrame(probe, { t: "ag_answer", aid: f.aid, sid: f.sid, rid: f.rid, option: f.option, text: f.text });
    this.d.toClients({ t: "ag_unreq", host: f.host, sid: f.sid, rid: f.rid, by } satisfies AgUnreqFrame);
  }

  /** 把配对请求转给主机探针, 在内存里等它的 ag_paired; 超时或主机断开返回 null。 */
  pair(subject: string, device: AgPairDevice, timeoutMs = AG_PAIR_TIMEOUT_MS): Promise<AgPairedFrame | null> {
    const probe = this.probeFor(subject);
    if (!probe) return Promise.resolve(null);
    const pid = randomId(PAIR_PREFIX);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), timeoutMs);
      const finish = (f: AgPairedFrame | null) => {
        clearTimeout(timer);
        this.pairs.delete(pid);
        resolve(f);
      };
      this.pairs.set(pid, { subject, done: finish });
      if (!sendFrame(probe, { t: "ag_pair", pid, device })) finish(null);
    });
  }

  /** 探针断开: 清它的索引, 等着的配对立刻失败, 广播主机变化。 */
  probeGone(att: Attachment): void {
    const subject = att.host?.subject;
    if (!subject || !isProbe(att)) return;
    const had = this.index.delete(subject);
    for (const p of [...this.pairs.values()]) if (p.subject === subject) p.done({ t: "ag_paired", pid: "", ok: false, err: ERR_GONE });
    if (had || att.host?.info.agent) this.broadcastHosts();
  }

  sweep(now = Date.now()): number {
    return this.d.store.sweep(now);
  }

  /** 主机卡片更新 (apply 是 metrics.host): 声明的 agent 路线变了才广播 ag_hosts。 */
  watchHost(ws: WebSocket, apply: () => void): void {
    const agentOf = () => JSON.stringify(attOf(ws).host?.info.agent ?? null);
    const before = agentOf();
    apply();
    if (agentOf() !== before) this.broadcastHosts();
  }
}

/** Hub 里的装配: 广播只给主人的 v1 客户端, 推送走 Web Push, 主机列表取指标模块的主机卡片。 */
export function agentGuiOf(sql: SqlStorage, all: () => WebSocket[], toClients: (f: unknown) => void, webpush: WebPush, metrics: MetricRouter): AgentGui {
  const push = async (p: WebPushPayload, urgent: boolean) => void (webpush.ready() && (await webpush.notify(p, urgent)));
  return new AgentGui({ all, toClients, store: new AgentGuiStore(sql), push, hostCards: () => metrics.hostsFrame().hosts });
}
