import {
  AG_ACK_TIMEOUT_MS,
  AG_PAIR_TIMEOUT_MS,
  ANDROID_DEVICE_PREFIX,
  type AgAckFrame,
  type AgAnsweredFrame,
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
// Hub 转给探针、还在等 ag_ack 的答复 (只在内存; DO 休眠丢了就只靠 ag_unreq 广播改正)
type AckWait = { device: string; host: string; sid: string; rid: string; by: AgUnreqBy; at: number };
// 探针断开 key 连接让它带新 scope 重连
const CLOSE_RESCOPE = 4010;
const RESCOPE_REASON = "scope 已更新, 请重连";
// 索引比较时不看 updated: 只为 updated 变了就广播没有意义
const indexSig = (items: AgIndexItem[]) => JSON.stringify(items.map(({ updated: _u, ...rest }) => rest));

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
  private readonly acks = new Map<string, AckWait>();
  // 本次 DO 生命周期里已发过 ag_reindex 的主机 (每台只发一次)
  private readonly reindexed = new Set<string>();

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
      .map((h) => {
        const denied = h.info.agent?.denied;
        if (denied) return { subject: h.subject, online: h.online, routes: [], sessions: [], denied };
        return { subject: h.subject, online: h.online, routes: h.info.agent?.routes ?? [], sessions: h.online ? (this.index.get(h.subject) ?? []) : [] };
      });
  }

  hostsFrame(): AgHostsFrame {
    return { t: "ag_hosts", hosts: this.hosts() };
  }

  /** 客户端 welcome 时给的 ag_hosts: DO 醒来后内存索引为空的在线 Agent 主机, 先请探针重报 (每台只请一次)。 */
  welcomeFrame(): AgHostsFrame {
    this.reindex();
    return this.hostsFrame();
  }

  /** 向内存里还没有索引的在线 Agent 探针发 ag_reindex; 返回发出的主机。 */
  reindex(): string[] {
    const sent: string[] = [];
    for (const ws of this.d.all()) {
      const a = attOf(ws);
      const subject = a.host?.subject;
      if (!subject || !isAgentProbe(a) || this.index.has(subject) || this.reindexed.has(subject)) continue;
      this.reindexed.add(subject);
      if (sendFrame(ws, { t: "ag_reindex" })) sent.push(subject);
    }
    return sent;
  }

  /** key 的 scope 改了: 断开用这些 key 连着的探针, 让它重连后带上新 scope。返回断开的连接数。 */
  rescope(keyIds: string[]): number {
    let n = 0;
    for (const ws of this.d.all()) {
      const a = attOf(ws);
      if (!isProbe(a) || !a.keyId || !keyIds.includes(a.keyId)) continue;
      try {
        ws.close(CLOSE_RESCOPE, RESCOPE_REASON);
        n += 1;
      } catch {}
    }
    return n;
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
      case "ag_index": {
        const prev = this.index.get(subject);
        this.index.set(subject, f.sessions);
        this.reconcile(subject, f.sessions);
        // 只有 updated 不同 (或完全相同) 的重报不广播
        if (prev && indexSig(prev) === indexSig(f.sessions)) return;
        return this.broadcastHosts();
      }
      case "ag_req":
        return this.request({ ...f.card, host: subject });
      case "ag_unreq":
        this.close(subject, f.sid, f.rid, f.by, true);
        return;
      case "ag_ack":
        return this.ack(subject, f);
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
    // 新请求: 有人在电脑前看着就静默推, 否则正常推; 重发且 quiet 变假: 补一次正常推送 (卡片与 loud 标记同一次写)
    const loud = !card.quiet;
    const r = this.d.store.put(card, now, loud);
    if (r.kind === "done") return;
    this.d.toClients({ t: "ag_req", card });
    if (r.kind === "update" && (!loud || r.loudBefore)) return;
    await this.d.push(pushOf(card), loud).catch((e) => console.error("Agent GUI 推送失败:", e));
  }

  // probe=true: 探针报的结果, 以它为准; Hub 已先按别的端收掉了也改正 by 并重新广播
  private close(host: string, sid: string, rid: string, by: AgUnreqBy, probe = false, now = Date.now()): boolean {
    const changed = this.d.store.done(host, rid, by, now) || (probe && this.d.store.setBy(host, rid, by));
    if (!changed) return false;
    const f: AgUnreqFrame = { t: "ag_unreq", host, sid, rid, by };
    this.d.toClients(f);
    return true;
  }

  // 探针对 Hub 转去的答复的确认: 生效回告 ok; 被别处抢先则改正并回告答题端 ok:false
  private ack(host: string, f: AgAckFrame): void {
    const w = this.acks.get(f.aid);
    this.acks.delete(f.aid);
    const mine = w && w.host === host && w.rid === f.rid ? w : undefined;
    if (f.by === "hub") {
      if (mine) this.tellAnswerer(mine.device, { t: "ag_answered", aid: f.aid, host, sid: f.sid, rid: f.rid, ok: true, by: mine.by });
      return;
    }
    this.close(host, f.sid, f.rid, f.by, true);
    if (mine) this.tellAnswerer(mine.device, { t: "ag_answered", aid: f.aid, host, sid: f.sid, rid: f.rid, ok: false, by: f.by });
  }

  private tellAnswerer(device: string, f: AgAnsweredFrame): void {
    for (const ws of this.d.all()) if (attOf(ws).device === device) sendFrame(ws, f);
  }

  private waitAck(aid: string, w: AckWait): void {
    for (const [k, v] of this.acks) if (v.at < w.at - AG_ACK_TIMEOUT_MS) this.acks.delete(k);
    this.acks.set(aid, w);
  }

  // 探针重连 / 重启后, 已经没有待批请求的会话里残留的卡片收掉
  private reconcile(host: string, sessions: AgIndexItem[], now = Date.now()): void {
    const live = new Map(sessions.map((s) => [s.id, s]));
    for (const row of this.d.store.openOf(host)) {
      const s = live.get(row.sid);
      if (row.at > now - RECONCILE_GRACE_MS) continue;
      if (!s || s.pending === 0 || s.state === "closed") this.close(host, row.sid, row.rid, "agent", false, now);
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
    this.waitAck(f.aid, { device: att.device, host: f.host, sid: f.sid, rid: f.rid, by, at: Date.now() });
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
