import type { PluginManifest } from "./plugin";
import { DAY_S, EXT_POINTS, cardOf, isExtPoint, type Contribution, type ExtPoint } from "./plugin-v2";
import { satisfies } from "./semver";

// 静态冲突检测: 清单里能算出来的全部在这里算, 市场 CI 与服务端放行时共用
export type ConflictKind = "engine" | "requires" | "duplicate" | "single" | "order" | "conflicts" | "budget";
export type PluginConflict = { kind: ConflictKind; plugins: string[]; detail: string };
export type CheckResult = { conflicts: PluginConflict[]; requests: Record<string, number>; total: number };
// defaults: 扩展点或服务 -> 管理员指定的默认提供者插件 id
export type CheckOptions = { engine: string; defaults?: Record<string, string>; budget?: number };

const MINUTES = 60;
const HOURS = 24;

function fieldCount(f: string, size: number): number {
  if (f === "*") return size;
  const step = /^\*\/(\d+)$/.exec(f);
  if (step) return Math.ceil(size / Math.max(1, Number(step[1])));
  return f.split(",").reduce((n, part) => {
    const [a, b] = part.split("-").map(Number);
    return n + (b === undefined ? 1 : Math.max(0, b - a! + 1));
  }, 0);
}

/** cron 每天最多触发几次 (只看分和时, 日月周按每天都触发算, 是上界)。 */
export function cronPerDay(cron: string): number {
  const [m, h] = cron.trim().split(/\s+/);
  return fieldCount(m!, MINUTES) * fieldCount(h!, HOURS);
}

/** 一个插件每天估算的请求数: cron + Agent 定时拉取 + 自报的其他请求。 */
export function dailyRequests(m: PluginManifest): number {
  const b = m.budget ?? {};
  const poll = b.agentPoll ?? m.agent.interval ?? 0;
  return (b.cron ? cronPerDay(b.cron) : 0) + (poll > 0 ? Math.ceil(DAY_S / poll) : 0) + (b.requestsPerDay ?? 0);
}

type Entry = { plugin: string; c: Contribution };

function contributions(ms: PluginManifest[]): Map<ExtPoint, Entry[]> {
  const out = new Map<ExtPoint, Entry[]>();
  for (const m of ms) {
    for (const [p, list] of Object.entries(m.contributes ?? {})) {
      if (!isExtPoint(p)) continue;
      const arr = out.get(p) ?? [];
      for (const c of list ?? []) arr.push({ plugin: m.id, c });
      out.set(p, arr);
    }
  }
  return out;
}

// pipeline: 边 a -> b 表示 a 在 b 之前
function orderIssues(point: string, list: Entry[]): PluginConflict[] {
  const ids = new Set(list.map((e) => e.c.id));
  const next = new Map<string, Set<string>>([...ids].map((i) => [i, new Set<string>()]));
  for (const { c } of list) {
    for (const b of c.before ?? []) if (ids.has(b)) next.get(c.id)!.add(b);
    for (const a of c.after ?? []) if (ids.has(a)) next.get(a)!.add(c.id);
  }
  const reach = (from: string, to: string) => {
    const seen = new Set<string>();
    const stack = [...next.get(from)!];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === to) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...next.get(x)!);
    }
    return false;
  };
  const out: PluginConflict[] = [];
  const owner = new Map(list.map((e) => [e.c.id, e.plugin]));
  for (const id of ids) if (reach(id, id)) out.push({ kind: "order", plugins: [owner.get(id)!], detail: `${point}: ${id} 的 before/after 成环` });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!.c;
      const b = list[j]!.c;
      const both = (a.writes ?? []).filter((w) => (b.writes ?? []).includes(w));
      if (both.length && !reach(a.id, b.id) && !reach(b.id, a.id)) {
        out.push({ kind: "order", plugins: [list[i]!.plugin, list[j]!.plugin], detail: `${point}: ${a.id} 与 ${b.id} 都写 ${both.join(", ")}, 但没有声明先后` });
      }
    }
  }
  return out;
}

/** 检查一组插件能否同时放进白名单。 */
export function checkPlugins(ms: PluginManifest[], opts: CheckOptions): CheckResult {
  const conflicts: PluginConflict[] = [];
  const defaults = opts.defaults ?? {};
  const byId = new Map(ms.map((m) => [m.id, m]));
  const providers = new Map<string, { plugin: string; version: string }[]>();
  for (const m of ms) for (const [s, v] of Object.entries(m.provides ?? {})) providers.set(s, [...(providers.get(s) ?? []), { plugin: m.id, version: v }]);

  for (const m of ms) {
    if (m.engines && !satisfies(opts.engine, m.engines.aioa)) conflicts.push({ kind: "engine", plugins: [m.id], detail: `要求宿主 ${m.engines.aioa}, 当前是 ${opts.engine}` });
    for (const [s, range] of Object.entries(m.requires ?? {})) {
      if (!(providers.get(s) ?? []).some((p) => p.plugin !== m.id && satisfies(p.version, range))) conflicts.push({ kind: "requires", plugins: [m.id], detail: `需要 ${s}@${range}, 白名单里没有满足的提供者` });
    }
    for (const [other, range] of Object.entries(m.conflicts ?? {})) {
      const o = byId.get(other);
      if (o && o.id !== m.id && satisfies(o.version, range)) conflicts.push({ kind: "conflicts", plugins: [m.id, o.id], detail: `${m.id} 声明与 ${o.id}@${range} 冲突` });
    }
  }
  for (const [s, list] of providers) {
    if (list.length > 1 && !list.some((p) => p.plugin === defaults[s])) conflicts.push({ kind: "single", plugins: list.map((p) => p.plugin), detail: `${s} 有多个提供者, 需要管理员指定默认` });
  }
  for (const [p, list] of contributions(ms)) {
    const card = cardOf(p);
    if (card === "single") {
      const plugins = [...new Set(list.map((e) => e.plugin))];
      if (plugins.length > 1 && !plugins.includes(defaults[p] ?? "")) conflicts.push({ kind: "single", plugins, detail: `${p} 只能有一个生效, 需要管理员指定默认` });
      continue;
    }
    if (!("scoped" in EXT_POINTS[p])) {
      const seen = new Map<string, string>();
      for (const { plugin, c } of list) {
        const prev = seen.get(c.id);
        if (prev && prev !== plugin) conflicts.push({ kind: "duplicate", plugins: [prev, plugin], detail: `${p}/${c.id} 撞名` });
        seen.set(c.id, plugin);
      }
    }
    if (card === "pipeline") conflicts.push(...orderIssues(p, list));
  }
  const requests = Object.fromEntries(ms.map((m) => [m.id, dailyRequests(m)]));
  const total = Object.values(requests).reduce((a, b) => a + b, 0);
  if (opts.budget !== undefined && total > opts.budget) conflicts.push({ kind: "budget", plugins: ms.map((m) => m.id), detail: `估算每天 ${total} 次请求, 超过上限 ${opts.budget}` });
  return { conflicts, requests, total };
}
