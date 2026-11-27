import { GITHUB_USER_AGENT } from "../constants";
import { type HeatState, type HeatYears, noteDate } from "./backfill";

// 贡献日历回填 (#140): 用 GraphQL contributionsCollection 一年一请求, 从注册那年拉到今年,
// 覆盖账号下所有仓库 (含私有, 看 token 权限) 的每日贡献数; 比逐仓库翻提交快得多, 一次同步就能铺满全部历史
const GRAPHQL = "https://api.github.com/graphql";
// 今年这一行多久刷新一次; 往年拉过就不再拉
const THIS_YEAR_TTL_MS = 10 * 60_000;
// 一次最多拉几年, 防止子请求超限
const MAX_YEARS = 8;
const QUERY = `query($from: DateTime!, $to: DateTime!) { viewer { createdAt contributionsCollection(from: $from, to: $to) {
  contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }`;

export type CalState = { created?: string; done: number[]; at?: number };

type CalDay = { date: string; contributionCount: number };
type CalRes = { data?: { viewer?: { createdAt?: string; contributionsCollection?: { contributionCalendar?: { weeks?: { contributionDays?: CalDay[] }[] } } } }; errors?: { message?: string }[] };

async function fetchYear(token: string, year: number): Promise<{ created?: string; days: CalDay[] }> {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "User-Agent": GITHUB_USER_AGENT },
    body: JSON.stringify({ query: QUERY, variables: { from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` } }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
  const b = (await res.json()) as CalRes;
  if (b.errors?.length) throw new Error(b.errors.map((e) => e.message).join("; "));
  const v = b.data?.viewer;
  const days = (v?.contributionsCollection?.contributionCalendar?.weeks ?? []).flatMap((w) => w.contributionDays ?? []);
  return { created: v?.createdAt, days };
}

/** 该拉的年份: 往年没拉过的 (从注册那年起, 新的在前), 今年过了 TTL 就重拉。 */
export function yearsToFetch(cal: CalState, thisYear: number, now: number): number[] {
  const from = cal.created ? Number(cal.created.slice(0, 4)) : thisYear;
  const out: number[] = [];
  if (!cal.at || now - cal.at >= THIS_YEAR_TTL_MS || !cal.done.includes(thisYear)) out.push(thisYear);
  for (let y = thisYear - 1; y >= from; y--) if (!cal.done.includes(y)) out.push(y);
  return out.slice(0, MAX_YEARS);
}

/** 拉贡献日历并写进年份行的 g 字段 (同一天取较大值); 第一次先拉今年, 顺带拿到注册时间再拉往年。 */
export async function calendarStep(token: string, state: HeatState, years: HeatYears, now: number, fetcher = fetchYear): Promise<number> {
  const cal: CalState = (state.cal ??= { done: [] });
  const thisYear = new Date(now).getUTCFullYear();
  let pulled = 0;
  for (let round = 0; round < 2; round++) {
    const want = yearsToFetch(cal, thisYear, now).filter((y) => round === 0 || y !== thisYear);
    if (!want.length) break;
    const got = await Promise.all(want.map((y) => fetcher(token, y).then((r) => ({ y, ...r }))));
    await years.load(want);
    for (const r of got) {
      if (r.created) cal.created = r.created;
      for (const d of r.days) {
        if (Number(d.date.slice(0, 4)) !== r.y) continue;
        years.add("g", d.date, d.contributionCount);
        if (d.contributionCount > 0) noteDate(state, d.date);
      }
      if (!cal.done.includes(r.y)) cal.done.push(r.y);
      pulled++;
    }
    cal.at = now;
    // 第一轮只知道今年时, 拿到注册时间后再来一轮补往年
    if (round === 0 && !cal.created) break;
  }
  return pulled;
}
