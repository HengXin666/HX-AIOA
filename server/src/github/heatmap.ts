import { GITHUB_HEATMAP_DAYS, type GithubActivityItem } from "@hx-aioa/protocol";

const DAY_MS = 24 * 3600_000;
const DATE_LEN = 10;
const WEEK_DAYS = 7;
// 改版前每天 cron 累计的一行 { days: 日期 -> 提交数 }, 第一次刷新时并进年份行后删掉
export type LegacyHeat = { days: Record<string, number>; updated: number };

/** ts 在 tz (IANA) 下的日期 YYYY-MM-DD。 */
export function dateIn(ts: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);
}

/** 从 today 往前 n 天的日期, 从早到晚; 按日历算, 不受夏令时影响。 */
export function lastDates(today: string, n: number): string[] {
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: n }, (_, k) => new Date(base - (n - 1 - k) * DAY_MS).toISOString().slice(0, DATE_LEN));
}

/** year 年 1 月 1 日到年底的日期, 今年只到 today; 未来的年份为空。 */
export function yearDates(year: number, today: string): string[] {
  const start = Date.parse(`${year}-01-01T00:00:00Z`);
  const last = `${year}-12-31` < today ? `${year}-12-31` : today;
  const n = Math.floor((Date.parse(`${last}T00:00:00Z`) - start) / DAY_MS) + 1;
  return n > 0 ? Array.from({ length: n }, (_, k) => new Date(start + k * DAY_MS).toISOString().slice(0, DATE_LEN)) : [];
}

/**
 * 最近 n 天, 再往前补到第一天所在那周的周一 (#144): 安卓按周一对齐成列,
 * 不补时第一列前几格画成空白, 可那几天其实有提交。
 */
export function recentDates(today: string, n = GITHUB_HEATMAP_DAYS): string[] {
  const first = lastDates(today, n)[0] as string;
  const back = (new Date(`${first}T00:00:00Z`).getUTCDay() + WEEK_DAYS - 1) % WEEK_DAYS;
  return lastDates(today, n + back);
}

/** 不带 year 是最近 GITHUB_HEATMAP_DAYS 天 (补齐到周一), 带 year 是那一年。 */
export const heatDates = (today: string, year?: number): string[] => (year ? yearDates(year, today) : recentDates(today));

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
