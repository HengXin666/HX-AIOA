import {
  METRIC_LIVE_INTERVAL_MS,
  PROBE_DEVICE_PREFIX,
  type DemandFrame,
  type MetricFrame,
  type ProbesFrame,
} from "@hx-aioa/protocol";

export type Attachment = {
  device: string;
  watch?: string[];
  offer?: string[];
  demand?: string[];
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export const isProbe = (a: Attachment) => a.device.startsWith(PROBE_DEVICE_PREFIX);

// 懒更新调度: 指标只转发不落库, 只缓存每个主体的最后一个点, 休眠后丢失也无妨 (探针下次会补历史)
export class MetricRouter {
  private readonly latest = new Map<string, MetricFrame>();
  private offered: string[] | null = null;

  constructor(private readonly sockets: () => WebSocket[]) {}

  watchers(subject: string): WebSocket[] {
    return this.sockets().filter((ws) => (this.att(ws).watch ?? []).includes(subject));
  }

  // 有人看的主体集合变化后, 给每个探针重算需求, 只在变化时下发
  rebalance(): void {
    const all = this.sockets();
    this.announce(all);
    const wanted = new Set(all.flatMap((ws) => this.att(ws).watch ?? []));
    for (const ws of all) {
      const a = this.att(ws);
      if (!isProbe(a)) continue;
      const demand = (a.offer ?? []).filter((s) => wanted.has(s));
      if (sameSet(demand, a.demand ?? [])) continue;
      ws.serializeAttachment({ ...a, demand } satisfies Attachment);
      const frame: DemandFrame = { t: "demand", subjects: demand, intervalMs: METRIC_LIVE_INTERVAL_MS };
      send(ws, frame);
    }
  }

  // 在线探针变化时告诉所有客户端, 让界面知道有哪些主体可看
  private announce(all: WebSocket[]): void {
    const now = this.online(all);
    if (this.offered && sameSet(now, this.offered)) return;
    this.offered = now;
    const frame: ProbesFrame = { t: "probes", subjects: now };
    for (const ws of all) if (!isProbe(this.att(ws))) send(ws, frame);
  }

  probes(): ProbesFrame {
    return { t: "probes", subjects: this.online(this.sockets()) };
  }

  private online(all: WebSocket[]): string[] {
    return [...new Set(all.flatMap((ws) => this.att(ws).offer ?? []))].sort();
  }

  relay(frame: MetricFrame): void {
    const last = frame.points[frame.points.length - 1];
    if (last) this.latest.set(frame.subject, { t: "metric", subject: frame.subject, points: [last] });
    const text = JSON.stringify(frame);
    for (const ws of this.watchers(frame.subject)) trySend(ws, text);
  }

  // 新开始看时先给缓存的最后值, 页面不必等第一次采样
  primeWatcher(ws: WebSocket, subjects: string[]): void {
    for (const s of subjects) {
      const f = this.latest.get(s);
      if (f) send(ws, f);
    }
  }

  private att(ws: WebSocket): Attachment {
    return ws.deserializeAttachment() as Attachment;
  }
}

function send(ws: WebSocket, frame: unknown): void {
  trySend(ws, JSON.stringify(frame));
}

function trySend(ws: WebSocket, text: string): void {
  try {
    ws.send(text);
  } catch {
    // 连接已失效, 由运行时回收
  }
}
