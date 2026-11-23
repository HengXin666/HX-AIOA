import type { GithubActivityItem, GithubDay } from "@hx-aioa/protocol";

const DAY_MS = 24 * 3600_000;
const MIN_MS = 60_000;

// 旧数据没有 action: 按标题开头的中文动词推断
const VERBS: [string, string][] = [
  ["合并", "merged"],
  ["关闭", "closed"],
  ["重新打开", "reopened"],
  ["打开", "opened"],
];

export function actionOf(i: GithubActivityItem): string {
  if (i.action) return i.action;
  return VERBS.find(([v]) => i.title.startsWith(v))?.[1] ?? "";
}

/** 当天零点 (按客户端时区, tz 为东区分钟数)。 */
export function dayStart(ts: number, tz: number): number {
  const off = tz * MIN_MS;
  return Math.floor((ts + off) / DAY_MS) * DAY_MS - off;
}

function label(start: number, tz: number): string {
  return new Date(start + tz * MIN_MS).toISOString().slice(0, 10);
}

function empty(start: number, tz: number): GithubDay {
  return { day: label(start, tz), start, commits: 0, pushes: 0, prOpened: 0, prMerged: 0, prClosed: 0, issueOpened: 0, issueClosed: 0, reviews: 0, comments: 0 };
}

/** 把动态按天累加; 推送没带提交数时按 1 个算。返回从早到晚 days 天。 */
export function dailyOf(items: GithubActivityItem[], now: number, days: number, tz: number): GithubDay[] {
  const today = dayStart(now, tz);
  const out = Array.from({ length: days }, (_, k) => empty(today - (days - 1 - k) * DAY_MS, tz));
  const first = out[0]?.start ?? today;
  for (const i of items) {
    const idx = Math.floor((dayStart(i.ts, tz) - first) / DAY_MS);
    const d = out[idx];
    if (!d) continue;
    const a = actionOf(i);
    if (i.kind === "push") {
      d.pushes += 1;
      d.commits += i.commits ?? 1;
    } else if (i.kind === "pr") {
      if (a === "merged") d.prMerged += 1;
      else if (a === "closed") d.prClosed += 1;
      else if (a === "opened" || a === "reopened") d.prOpened += 1;
    } else if (i.kind === "issue") {
      if (a === "closed") d.issueClosed += 1;
      else if (a === "opened" || a === "reopened") d.issueOpened += 1;
    } else if (i.kind === "review") d.reviews += 1;
    else if (i.kind === "comment") d.comments += 1;
  }
  return out;
}

const busy = (d: GithubDay) => d.pushes + d.prOpened + d.prMerged + d.prClosed + d.issueOpened + d.issueClosed + d.reviews + d.comments > 0;

/** 连续活跃天数: 今天还没动静时从昨天往回数, 不算断。 */
export function streakOf(days: GithubDay[]): number {
  let n = 0;
  for (let k = days.length - 1; k >= 0; k--) {
    const d = days[k] as GithubDay;
    if (busy(d)) n += 1;
    else if (k !== days.length - 1) break;
  }
  return n;
}
