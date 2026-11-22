import { METRIC_FIELDS, spaceBinds, type BindValue, type Envelope, type Space, type SpaceData } from "@hx-aioa/protocol";
import type { MetricRouter } from "./metrics";

const ANY_SUBJECT = "*";
const FEED_LIMIT = 20;

// 按绑定解析当前值: 指标取每个主体的最新点 (内存优先, 休眠后读落库), 列表与报告取最近事件
export function resolveSpaceData(space: Space, metrics: MetricRouter, recent: Envelope[], now = Date.now()): SpaceData {
  const { metrics: mb, feeds } = spaceBinds(space);
  const latest = metrics.latestOf([...new Set(mb.map((b) => b.subject))]);
  const seen = new Set<string>();
  const values: BindValue[] = [];
  for (const b of mb) {
    const key = `${b.subject}|${b.field}`;
    const point = latest[b.subject];
    const value = point?.values[b.field];
    if (seen.has(key) || !point || value === undefined) continue;
    seen.add(key);
    const unit = point.units?.[b.field] ?? METRIC_FIELDS[b.field]?.unit;
    values.push({ subject: b.subject, field: b.field, value, ts: point.ts, ...(unit ? { unit } : {}) });
  }
  const subjects = new Set(feeds.map((b) => b.subject));
  const events = [...recent]
    .sort((a, b) => b.seq - a.seq)
    .filter((e) => e.kind !== "metric" && e.kind !== "task" && (subjects.has(ANY_SUBJECT) || (e.subject !== undefined && subjects.has(e.subject))))
    .slice(0, FEED_LIMIT);
  return { id: space.id, generatedAt: now, values, events };
}
