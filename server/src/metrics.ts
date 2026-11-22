import {
  defaultUnits,
  normalizeMetricValues,
  METRIC_LIVE_INTERVAL_MS,
  PROBE_DEVICE_PREFIX,
  type DemandFrame,
  type HostCard,
  type HostFrame,
  type HostsFrame,
  type MetricData,
  type MetricFrame,
  type MetricLatest,
  type ProbesFrame,
} from "@hx-aioa/protocol";
import { METRIC_PERSIST_MS } from "./constants";
import { type Attachment, attOf, sendFrame, trySend } from "./sockets";

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export const isProbe = (a: Attachment) => a.role === "probe" || a.device.startsWith(PROBE_DEVICE_PREFIX);

// 懒更新调度: 指标只转发不逐点落库; 每个主体只存最新值, 且最多每 METRIC_PERSIST_MS 写一次
export class MetricRouter {
  private readonly latest = new Map<string, MetricFrame>();
  private readonly units = new Map<string, Record<string, string>>();
  private readonly persisted = new Map<string, number>();
  private offered: string[] | null = null;

  constructor(
    private readonly sockets: () => WebSocket[],
    private readonly sql: SqlStorage,
  ) {
    sql.exec("CREATE TABLE IF NOT EXISTS metric_latest (subject TEXT PRIMARY KEY, ts INTEGER NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS probe_host (subject TEXT PRIMARY KEY, body TEXT NOT NULL)");
  }

  // 主机快照只存进探针连接的 attachment, 不写库; 在看资源页的连接顺带收到
  host(ws: WebSocket, att: Attachment, frame: HostFrame): void {
    const info = { ...frame.info };
    if (!att.shell) delete info.shell;
    const card: HostCard = { subject: frame.subject, online: true, seen: Date.now(), info };
    if (frame.last) card.last = frame.last;
    if (frame.avail !== undefined) card.avail = frame.avail;
    if (frame.beats) {
      card.beats = frame.beats;
      card.beatsAt = frame.beatsAt;
    }
    ws.serializeAttachment({ ...att, host: card } satisfies Attachment);
    this.broadcastHosts();
  }

  // 探针断开: 唯一一次写库, 留一行离线快照给卡片显示 "最后在线"
  offline(card: HostCard): void {
    const { shell: _s, ...info } = card.info;
    const body: HostCard = { ...card, info, online: false, seen: Date.now() };
    this.sql.exec("INSERT OR REPLACE INTO probe_host (subject, body) VALUES (?, ?)", card.subject, JSON.stringify(body));
  }

  hostsFrame(): HostsFrame {
    const online = this.sockets().map((ws) => attOf(ws)).filter((a) => isProbe(a) && a.host).map((a) => a.host!);
    const live = new Set(online.map((h) => h.subject));
    const rows = this.sql.exec<{ body: string }>("SELECT body FROM probe_host").toArray();
    const offline = rows.map((r) => JSON.parse(r.body) as HostCard).filter((h) => !live.has(h.subject));
    return { t: "hosts", hosts: [...online, ...offline].sort((a, b) => a.subject.localeCompare(b.subject)) };
  }

  broadcastHosts(): void {
    const targets = this.sockets().filter((ws) => (attOf(ws).watch ?? []).length > 0);
    if (!targets.length) return;
    const text = JSON.stringify(this.hostsFrame());
    for (const ws of targets) trySend(ws, text);
  }

  watchers(subject: string): WebSocket[] {
    return this.sockets().filter((ws) => (attOf(ws).watch ?? []).includes(subject));
  }

  // 有人看的主体集合变化后, 给每个探针重算需求, 只在变化时下发
  rebalance(): void {
    const all = this.sockets();
    this.announce(all);
    const wanted = new Set(all.flatMap((ws) => attOf(ws).watch ?? []));
    for (const ws of all) {
      const a = attOf(ws);
      if (!isProbe(a)) continue;
      const demand = (a.offer ?? []).filter((s) => wanted.has(s));
      if (sameSet(demand, a.demand ?? [])) continue;
      ws.serializeAttachment({ ...a, demand } satisfies Attachment);
      const frame: DemandFrame = { t: "demand", subjects: demand, intervalMs: METRIC_LIVE_INTERVAL_MS };
      sendFrame(ws, frame);
    }
  }

  private announce(all: WebSocket[]): void {
    const now = this.online(all);
    if (this.offered && sameSet(now, this.offered)) return;
    this.offered = now;
    const frame: ProbesFrame = { t: "probes", subjects: now };
    for (const ws of all) if (!isProbe(attOf(ws))) sendFrame(ws, frame);
  }

  probes(): ProbesFrame {
    return { t: "probes", subjects: this.online(this.sockets()) };
  }

  private online(all: WebSocket[]): string[] {
    return [...new Set(all.flatMap((ws) => attOf(ws).offer ?? []))].sort();
  }

  // 不论来自探针还是 HTTP, 转发前统一换成标准字段名, 组件绑定与来源无关
  // persist 为 false 时只转发 (探针实时点), 不写库
  relay(raw: MetricFrame, persist = true): void {
    const frame: MetricFrame = { ...raw, points: raw.points.map((p) => ({ ts: p.ts, values: normalizeMetricValues(p.values) })) };
    const last = frame.points[frame.points.length - 1];
    if (last && !frame.history) {
      // 同一主体的字段可能来自不同来源 (如 Prometheus 每条只带一个字段), 最新值按字段合并
      const prev = this.latest.get(frame.subject)?.points[0]?.values;
      const merged = { ts: last.ts, values: { ...prev, ...last.values } };
      this.latest.set(frame.subject, { t: "metric", subject: frame.subject, points: [merged] });
      if (persist) this.persist(frame.subject, merged.ts, merged.values);
    }
    const text = JSON.stringify(frame);
    for (const ws of this.watchers(frame.subject)) trySend(ws, text);
  }

  // HTTP 写入的 metric 事件: 不进收件箱, 转成 metric 帧发给在看的连接
  ingest(subject: string, data: MetricData, ts: number): void {
    const values = normalizeMetricValues(data.values);
    this.units.set(subject, defaultUnits(values, { ...this.units.get(subject), ...data.units }));
    this.relay({ t: "metric", subject, points: [{ ts, values }] });
  }

  private persist(subject: string, ts: number, values: Record<string, number>): void {
    const last = this.persisted.get(subject) ?? 0;
    if (ts - last < METRIC_PERSIST_MS) return;
    this.persisted.set(subject, ts);
    const body: MetricLatest = { ts, values };
    const units = this.units.get(subject);
    if (units) body.units = units;
    this.sql.exec("INSERT OR REPLACE INTO metric_latest (subject, ts, body) VALUES (?, ?, ?)", subject, ts, JSON.stringify(body));
  }

  // 内存里的最新值优先, 休眠后退回落库的值
  latestOf(subjects: string[]): Record<string, MetricLatest> {
    const out: Record<string, MetricLatest> = {};
    for (const s of subjects) {
      const mem = this.latest.get(s)?.points[0];
      if (mem) {
        const v: MetricLatest = { ts: mem.ts, values: mem.values };
        const units = this.units.get(s);
        if (units) v.units = units;
        out[s] = v;
        continue;
      }
      const card = this.sockets().map((ws) => attOf(ws).host).find((h) => h?.subject === s && h.last);
      if (card?.last) {
        out[s] = { ts: card.last.ts, values: card.last.values };
        continue;
      }
      const row = this.sql.exec<{ body: string }>("SELECT body FROM metric_latest WHERE subject = ?", s).toArray()[0];
      if (row) out[s] = JSON.parse(row.body) as MetricLatest;
    }
    return out;
  }

  primeWatcher(ws: WebSocket, subjects: string[]): void {
    for (const s of subjects) {
      const f = this.latest.get(s);
      if (f) sendFrame(ws, f);
    }
  }
}
