import { GITHUB_HEATMAP_DAYS, type GithubActivityItem, type GithubHeatmap } from "@hx-aioa/protocol";

const DAY_MS = 24 * 3600_000;
// 动态只留 30 天, 更早的天数靠每天 cron 累计在这一行里
export type HeatStore = { days: Record<string, number>; updated: number };

/** ts 在 tz (IANA) 下的日期 YYYY-MM-DD。 */
export function dateIn(ts: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);
}

/** 从 today 往前 n 天的日期, 从早到晚; 按日历算, 不受夏令时影响。 */
export function lastDates(today: string, n: number): string[] {
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: n }, (_, k) => new Date(base - (n - 1 - k) * DAY_MS).toISOString().slice(0, 10));
}

/** 推送按天累加提交数 (没带提交数的推送算 1 个)。 */
export function commitsByDate(items: GithubActivityItem[], tz: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of items) {
    if (i.kind !== "push") continue;
    const d = dateIn(i.ts, tz);
    out.set(d, (out.get(d) ?? 0) + (i.commits ?? 1));
  }
  return out;
}

/** 合进已存的: 同一天取较大值 (动态只会因过期变少), 只留最近 GITHUB_HEATMAP_DAYS 天。 */
export function mergeHeat(prev: HeatStore | undefined, fresh: Map<string, number>, today: string, now: number): HeatStore {
  const days: Record<string, number> = {};
  for (const d of lastDates(today, GITHUB_HEATMAP_DAYS)) {
    const n = Math.max(prev?.days[d] ?? 0, fresh.get(d) ?? 0);
    if (n) days[d] = n;
  }
  return { days, updated: now };
}

/** 给客户端: 补满 GITHUB_HEATMAP_DAYS 天, 最近两天用实时动态覆盖 (cron 之后的新提交也能看到)。 */
export function heatmapOf(saved: HeatStore, live: Map<string, number>, today: string): GithubHeatmap {
  const days = lastDates(today, GITHUB_HEATMAP_DAYS).map((date) => ({ date, commits: Math.max(saved.days[date] ?? 0, live.get(date) ?? 0) }));
  return { days, updated: saved.updated };
}
