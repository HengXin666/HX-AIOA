import type { AgentStatus,
  Bind,
  Envelope,
  MetricPoint,
  Overview,
  Space,
  TaskLogEntry,
  TaskSnapshot,
  Threshold,
} from "@hx-aioa/protocol";
import { ANY, EVENTS_LIMIT, FIELD_EVENTS, FIELD_REPORT, FIELD_TASK, SERIES_LIMIT } from "../constants";

export type Point = { ts: number; v: number };
export type Listener = () => void;

export const TOPIC_SPACES = "app|spaces";
export const TOPIC_LINK = "app|link";
export const TOPIC_AGENTS = "app|agents";
export const TOPIC_TASKS = `${ANY}|${FIELD_TASK}`;
export const TOPIC_EVENTS = `${ANY}|${FIELD_EVENTS}`;

export const topicOf = (subject: string, field: string) => `${subject}|${field}`;
// 插件数据有变 (pdata_sync): 组件按 (插件, 集合) 订阅, 新 rev 记在 pdataRev
export const pdataTopic = (plugin: string, coll: string) => `pdata|${plugin}|${coll}`;

// 唯一数据中心: 组件只按 subject + field 订阅, 数据由流或 mock 灌入
export class Store {
  ready = false;
  online = false;
  linkError: string | null = null;
  private series = new Map<string, Point[]>();
  private units = new Map<string, string>();
  private thresholds = new Map<string, Threshold>();
  private updated = new Map<string, number>();
  private errors = new Map<string, string>();
  readonly events = new Map<string, Envelope>();
  readonly tasks = new Map<string, TaskSnapshot>();
  readonly pdataRev = new Map<string, number>();
  readonly logs = new Map<string, TaskLogEntry[]>();
  spaces: Space[] = [];
  agents: AgentStatus[] = [];
  overview: Overview | null = null;
  private listeners = new Map<string, Set<Listener>>();

  on(topic: string, fn: Listener): () => void {
    let set = this.listeners.get(topic);
    if (!set) this.listeners.set(topic, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  onBind(b: Bind, fn: Listener): () => void {
    return this.on(topicOf(b.subject, b.field), fn);
  }

  emit(topic: string): void {
    this.listeners.get(topic)?.forEach((fn) => fn());
  }

  private touch(subject: string, field: string, ts: number): void {
    const key = topicOf(subject, field);
    this.updated.set(key, Math.max(this.updated.get(key) ?? 0, ts));
    this.errors.delete(key);
    this.emit(key);
    if (subject !== ANY) {
      this.updated.set(topicOf(ANY, field), ts);
      this.emit(topicOf(ANY, field));
    }
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    this.emit(TOPIC_LINK);
  }

  setLink(online: boolean, error: string | null = null): void {
    this.online = online;
    this.linkError = error;
    this.emit(TOPIC_LINK);
  }

  setError(b: Bind, text: string): void {
    const key = topicOf(b.subject, b.field);
    this.errors.set(key, text);
    this.emit(key);
  }

  errorOf(b: Bind): string | undefined {
    return this.errors.get(topicOf(b.subject, b.field));
  }

  lastUpdate(b: Bind): number | undefined {
    return this.updated.get(topicOf(b.subject, b.field));
  }

  seriesOf(b: Bind): Point[] {
    const all = this.series.get(topicOf(b.subject, b.field)) ?? [];
    const ms = rangeMs(b.range);
    if (!ms || !all.length) return all;
    const from = all.at(-1)!.ts - ms;
    return all.filter((p) => p.ts >= from);
  }

  unitOf(b: Bind): string {
    return this.units.get(topicOf(b.subject, b.field)) ?? "";
  }

  thresholdOf(b: Bind): Threshold | undefined {
    return this.thresholds.get(topicOf(b.subject, b.field));
  }

  ingestPoints(subject: string, points: MetricPoint[], units?: Record<string, string>, th?: Record<string, Threshold>): void {
    const fields = new Set<string>();
    for (const p of points) {
      for (const [field, v] of Object.entries(p.values)) {
        const key = topicOf(subject, field);
        const arr = this.series.get(key) ?? [];
        if ((arr.at(-1)?.ts ?? -1) < p.ts) arr.push({ ts: p.ts, v });
        if (arr.length > SERIES_LIMIT) arr.splice(0, arr.length - SERIES_LIMIT);
        this.series.set(key, arr);
        fields.add(field);
      }
    }
    for (const [f, u] of Object.entries(units ?? {})) this.units.set(topicOf(subject, f), u);
    for (const [f, t] of Object.entries(th ?? {})) this.thresholds.set(topicOf(subject, f), t);
    const ts = points.at(-1)?.ts ?? Date.now();
    fields.forEach((f) => this.touch(subject, f, ts));
  }

  ingest(ev: Envelope): void {
    if (ev.kind === "metric") {
      this.ingestPoints(ev.subject ?? ev.source.id, [{ ts: ev.ts, values: ev.data.values }], ev.data.units, ev.data.thresholds);
      return;
    }
    if (ev.kind === "task") return this.ingestTask(ev.data);
    // 撤回 / 删除的墓碑: 网页只做查看, 直接去掉
    if (ev.deleted) {
      this.events.delete(ev.id);
      this.touch(ev.subject ?? ANY, FIELD_EVENTS, ev.ts);
      return;
    }
    this.events.set(ev.id, ev);
    if (this.events.size > EVENTS_LIMIT) this.events.delete(this.events.keys().next().value!);
    const field = ev.kind === "report" ? FIELD_REPORT : FIELD_EVENTS;
    this.touch(ev.subject ?? ANY, field, ev.ts);
    if (ev.kind === "report") this.touch(ev.subject ?? ANY, FIELD_EVENTS, ev.ts);
  }

  ingestTask(task: TaskSnapshot): void {
    this.tasks.set(task.id, task);
    this.touch(task.id, FIELD_TASK, task.updated);
  }

  appendLog(taskId: string, entry: TaskLogEntry): void {
    const arr = this.logs.get(taskId) ?? [];
    arr.push(entry);
    this.logs.set(taskId, arr);
    this.emitLog(taskId);
  }

  setLog(taskId: string, log: TaskLogEntry[]): void {
    this.logs.set(taskId, log);
    this.emitLog(taskId);
  }

  // 对话组件可能按 * 订阅, 日志变化也要通知
  private emitLog(taskId: string): void {
    this.emit(topicOf(taskId, FIELD_TASK));
    this.emit(TOPIC_TASKS);
  }

  setAgents(list: AgentStatus[]): void {
    this.agents = list;
    this.emit(TOPIC_AGENTS);
  }

  upsertSpace(space: Space): void {
    const i = this.spaces.findIndex((s) => s.id === space.id);
    if (i >= 0) this.spaces[i] = space;
    else this.spaces.push(space);
    this.emit(TOPIC_SPACES);
  }

  removeSpace(id: string): void {
    this.spaces = this.spaces.filter((s) => s.id !== id);
    this.emit(TOPIC_SPACES);
  }

  eventsFor(subject: string): Envelope[] {
    const list = [...this.events.values()].filter((e) => subject === ANY || e.subject === subject);
    return list.sort((a, b) => b.ts - a.ts);
  }

  subjects(): string[] {
    const set = new Set<string>();
    for (const key of this.series.keys()) set.add(key.split("|")[0]!);
    return [...set];
  }
}

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function rangeMs(range: string | undefined): number {
  const m = range?.match(/^(\d+)([smhd])$/);
  return m ? Number(m[1]) * (UNIT_MS[m[2]!] ?? 0) : 0;
}
