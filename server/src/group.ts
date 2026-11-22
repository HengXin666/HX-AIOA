import type { Envelope, EventGroup, Overview, OverviewItem, Priority, TaskSnapshot } from "@hx-aioa/protocol";
import { statusOf } from "./rules/engine";

export const GROUP_OPEN_MS = 6 * 3600_000;
export const MERGE_WINDOW_MS = 60_000;
const DAY_MS = 24 * 3600_000;
const WEEK_MS = 7 * DAY_MS;
const LAYER_LIMITS: Record<Priority, number> = { need_me: 20, happening: 30, worth_reading: 10 };

export function titleOf(ev: Envelope): string {
  if (ev.kind === "metric") return ev.subject ?? "";
  return ev.data.title;
}

export function isClosed(ev: Envelope): boolean {
  if (ev.resolved || statusOf(ev) === "resolved") return true;
  return ev.kind === "task" && ["done", "failed", "cancelled"].includes(ev.data.state);
}

// 同类判定: 有 groupKey 按组, 否则按 来源|subject|标题
export function sameKind(ev: Envelope): string {
  return ev.groupKey ? `g:${ev.groupKey}` : `${ev.source.id}|${ev.subject ?? ""}|${titleOf(ev)}`;
}

// 在最近的收件箱里找根因与同类计数, recent 按 seq 升序
export function groupContext(ev: Envelope, recent: Envelope[], now: number): { groupRoot?: { id: string; count: number }; recentSame: number } {
  const others = recent.filter((x) => x.id !== ev.id);
  let groupRoot: { id: string; count: number } | undefined;
  if (ev.groupKey) {
    const members = others.filter((x) => x.groupKey === ev.groupKey && x.ts > now - GROUP_OPEN_MS);
    const open = members.filter((x) => !isClosed(x));
    const first = open[0];
    if (first) groupRoot = { id: first.root ?? first.id, count: members.length };
  }
  const key = sameKind(ev);
  const recentSame = others.filter((x) => x.ts > now - MERGE_WINDOW_MS && sameKind(x) === key).length;
  const out: { groupRoot?: { id: string; count: number }; recentSame: number } = { recentSame };
  if (groupRoot) out.groupRoot = groupRoot;
  return out;
}

export function buildGroups(evs: Envelope[]): EventGroup[] {
  const map = new Map<string, EventGroup>();
  for (const ev of [...evs].sort((a, b) => a.seq - b.seq)) {
    if (!ev.groupKey) continue;
    let g = map.get(ev.groupKey);
    if (!g) {
      g = { key: ev.groupKey, root: ev.root ?? ev.id, title: titleOf(ev), priority: ev.priority, ids: [], count: 0, open: 0, first: ev.ts, last: ev.ts };
      map.set(ev.groupKey, g);
    }
    g.ids.push(ev.id);
    g.count += 1;
    if (!isClosed(ev)) g.open += 1;
    g.first = Math.min(g.first, ev.ts);
    g.last = Math.max(g.last, ev.ts);
    if (rank(ev.priority) > rank(g.priority)) g.priority = ev.priority;
  }
  return [...map.values()].sort((a, b) => b.last - a.last);
}

const rank = (p: Priority) => (p === "need_me" ? 2 : p === "happening" ? 1 : 0);

function layerOf(ev: Envelope, now: number): Priority | null {
  const action = ev.route?.action;
  if (action === "drop" || ev.kind === "task" || ev.kind === "metric") return null;
  if (ev.expires && ev.expires < now) return null;
  if (action === "digest" || ev.kind === "report") return ev.ts > now - WEEK_MS ? "worth_reading" : null;
  if (isClosed(ev)) return null;
  if (ev.priority === "need_me") return ev.ts > now - WEEK_MS ? "need_me" : null;
  if (ev.priority === "happening") return ev.ts > now - DAY_MS ? "happening" : null;
  return ev.ts > now - WEEK_MS ? "worth_reading" : null;
}

// 总览: 各层内同 groupKey 折叠, ev 为最新一条, ids 保留全部原始事件
export function buildOverview(evs: Envelope[], tasks: TaskSnapshot[], now: number): Overview {
  const layers: Record<Priority, OverviewItem[]> = { need_me: [], happening: [], worth_reading: [] };
  const index = new Map<string, OverviewItem>();
  for (const ev of [...evs].sort((a, b) => b.ts - a.ts)) {
    const layer = layerOf(ev, now);
    if (!layer) continue;
    const key = ev.groupKey ? `${layer}|${ev.groupKey}` : `${layer}|${ev.id}`;
    const hit = index.get(key);
    if (hit) {
      hit.count += 1;
      hit.ids.push(ev.id);
      continue;
    }
    if (layers[layer].length >= LAYER_LIMITS[layer]) continue;
    const item: OverviewItem = { ev, count: 1, ids: [ev.id] };
    index.set(key, item);
    layers[layer].push(item);
  }
  const active = tasks.filter((t) => t.state === "running" || t.state === "waiting").sort((a, b) => b.updated - a.updated);
  return { layers, tasks: active, generatedAt: now };
}
