import type { GithubHeatBackfill } from "@hx-aioa/protocol";
import { s } from "../adapters/types";
import { dateIn } from "./heatmap";
import { type Obj, obj } from "./map";
import { type RestRes, isoSec, restGet } from "./rest";
import { repoKey } from "./store";

// 热力图历史 (#134): 按年一行存每天的提交数, c 为回填的 (各仓库本人提交求和), e 为动态累计的 (同一天取较大值)
export const KV_HEAT_STATE = "githubHeatState";
const YEAR_PREFIX = "githubHeat:";
const PER_PAGE = 100;
// 同时拉几页, 免得触发 GitHub 的并发限制
const PARALLEL = 5;
// 本小时额度低于这个就停手, 留给页面与同步
const RATE_FLOOR = 200;
// 一个窗口拉完后, 隔这么久再开下一个增量窗口
const WINDOW_GAP_MS = 20 * 3600_000;
const SEC = 1000;
const FORBIDDEN = 403;
const GONE = new Set([FORBIDDEN, 404, 409, 451]);
const TOO_MANY = 429;

export type HeatYear = { c?: Record<string, number>; e?: Record<string, number> };
// page 为下一页页码, 0 表示当前窗口 [since, until] 已拉完; at 为窗口开始或拉完的时间
export type RepoCursor = { since?: string; until: string; page: number; at: number; error?: string };
export type HeatState = { repos: Record<string, RepoCursor>; years: number[]; oldest?: string; updated: number; tz?: string };

export const yearKey = (y: number) => YEAR_PREFIX + y;
export const yearOf = (date: string) => Number(date.slice(0, 4));
export const emptyState = (now: number): HeatState => ({ repos: {}, years: [], updated: now });

/** 年份行的读写缓冲: 一次运行改到的年份最后各写一行。 */
export class HeatYears {
  private readonly rows = new Map<number, HeatYear>();
  private readonly dirty = new Set<number>();

  constructor(private readonly storage: DurableObjectStorage) {}

  async load(years: Iterable<number>): Promise<void> {
    const want = [...new Set(years)].filter((y) => !this.rows.has(y));
    if (!want.length) return;
    const got = await this.storage.get<HeatYear>(want.map(yearKey));
    for (const y of want) this.rows.set(y, got.get(yearKey(y)) ?? {});
  }

  count(date: string): number {
    const r = this.rows.get(yearOf(date));
    return Math.max(r?.c?.[date] ?? 0, r?.e?.[date] ?? 0);
  }

  /** 回填的提交求和; 动态取较大值。调用前要先 load 该年。 */
  add(field: "c" | "e", date: string, n: number): void {
    const y = yearOf(date);
    const row = this.rows.get(y);
    if (!row || n <= 0) return;
    const m = (row[field] ??= {});
    const next = field === "c" ? (m[date] ?? 0) + n : Math.max(m[date] ?? 0, n);
    if (next === m[date]) return;
    m[date] = next;
    this.dirty.add(y);
  }

  /** 改过的年份行, 交给调用方跟状态行一起写。 */
  changes(): Record<string, HeatYear> {
    return Object.fromEntries([...this.dirty].map((y) => [yearKey(y), this.rows.get(y) as HeatYear]));
  }
}

/** 记下有数据的年份与最早一天。 */
export function noteDate(state: HeatState, d: string): void {
  if (!state.years.includes(yearOf(d))) state.years.push(yearOf(d));
  if (!state.oldest || d < state.oldest) state.oldest = d;
}

/** 给关注的仓库开窗口: 新仓库从现在往前拉全部历史, 拉完的隔一段时间开增量窗口。 */
export function openWindows(state: HeatState, repos: string[], now: number): void {
  for (const repo of repos) {
    const k = repoKey(repo);
    const cur = state.repos[k];
    if (!cur) state.repos[k] = { until: isoSec(now), page: 1, at: now };
    else if (cur.page === 0 && now - cur.at >= WINDOW_GAP_MS) state.repos[k] = { since: isoSec(Date.parse(cur.until) + SEC), until: isoSec(now), page: 1, at: now };
  }
}

export function commitsPath(repo: string, login: string, c: RepoCursor): string {
  const since = c.since ? `&since=${c.since}` : "";
  return `/repos/${repo}/commits?author=${encodeURIComponent(login)}&per_page=${PER_PAGE}&page=${c.page}&until=${c.until}${since}`;
}

const commitDate = (c: Obj) => Date.parse(s(obj(obj(c.commit).author).date)) || 0;

type Step = { token: string; login: string; repos: string[]; state: HeatState; years: HeatYears; tz: string; budget: number; now: number };

/** 一页结果记进年份行并推进游标; 返回是否该停手 (限流或额度见底)。 */
async function applyPage(st: Step, repo: string, r: RestRes): Promise<boolean> {
  const cur = st.state.repos[repoKey(repo)] as RepoCursor;
  // 额度用完的 403 与 429 等下次; 额度还多的 403 是没权限, 当仓库看不到
  if (r.status === TOO_MANY || (r.status === FORBIDDEN && r.remaining < RATE_FLOOR)) return true;
  if (GONE.has(r.status) || (r.ok && !Array.isArray(r.body))) {
    Object.assign(cur, { page: 0, at: st.now, error: `GitHub ${r.status}` });
    return r.remaining < RATE_FLOOR;
  }
  if (!r.ok) {
    cur.error = `GitHub ${r.status}`;
    return r.remaining < RATE_FLOOR;
  }
  const list = (r.body as unknown[]).map(obj);
  const dates = list.map(commitDate).filter((t) => t > 0).map((t) => dateIn(t, st.tz));
  await st.years.load(dates.map(yearOf));
  for (const d of dates) {
    st.years.add("c", d, 1);
    noteDate(st.state, d);
  }
  delete cur.error;
  if (list.length < PER_PAGE) Object.assign(cur, { page: 0, at: st.now });
  else cur.page += 1;
  return r.remaining < RATE_FLOOR;
}

/** 回填一步: 最多拉 budget 页 (每页一次 GitHub 调用), 返回拉了几页。 */
export async function backfillStep(st: Step): Promise<number> {
  openWindows(st.state, st.repos, st.now);
  let used = 0;
  const failed = new Set<string>();
  while (used < st.budget) {
    const batch = st.repos.filter((r) => !failed.has(r) && (st.state.repos[repoKey(r)]?.page ?? 0) > 0).slice(0, Math.min(PARALLEL, st.budget - used));
    if (!batch.length) break;
    const res = await Promise.all(batch.map((r) => restGet(st.token, commitsPath(r, st.login, st.state.repos[repoKey(r)] as RepoCursor))));
    used += batch.length;
    let stop = false;
    for (const [i, r] of res.entries()) {
      const repo = batch[i] as string;
      if (!r.ok) failed.add(repo);
      stop = (await applyPage(st, repo, r)) || stop;
    }
    if (stop) break;
  }
  return used;
}

export function backfillOf(state: HeatState, repos: string[]): GithubHeatBackfill {
  const pending = repos.filter((r) => (state.repos[repoKey(r)]?.page ?? 1) > 0 && !state.repos[repoKey(r)]?.since).length;
  const out: GithubHeatBackfill = { done: pending === 0, repos: repos.length, pending };
  if (state.oldest) out.oldest = state.oldest;
  return out;
}
