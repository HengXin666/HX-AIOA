import type { GithubFootprint, GithubTrendPoint, GithubTrendSeries } from "@hx-aioa/protocol";
import { GITHUB_TREND_DAYS, GITHUB_TREND_WEEKS } from "@hx-aioa/protocol";
import { lastDates } from "./heatmap";
import { type TrendFetcher, type TrendKind, type TrendPage, type TrendRow, FOOTPRINT_LIMIT, fetchTrend, parseTrend } from "./trend-fetch";

const DAY_MS = 24 * 3600_000;
const WEEK = 7;
// 往前补多久: 12 周 + 本周 + 余量; 行按最后一次动静留 HORIZON + 7 天
export const TREND_HORIZON_MS = 98 * DAY_MS;
export const TREND_KEEP_MS = TREND_HORIZON_MS + WEEK * DAY_MS;
const KEEP_MS = TREND_KEEP_MS;
// 新建仓库与 star 每次整份重拿, 不按时间删
const KEPT: TrendKind[] = ["repo", "star"];

// ia / pa: 贡献集合里我开的 Issue / PR 往前翻的游标; 旧状态没有 iDone / pDone, 读到 undefined 就当没翻完 (#145)
export type TrendState = { at?: number; before?: string; cmtDone: boolean; ia?: string; pa?: string; iDone?: boolean; pDone?: boolean };
export const emptyTrend = (): TrendState => ({ cmtDone: false });

type Row = { k: string; kind: TrendKind; ts: number; body: string };

export class TrendStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS gh_trend (k TEXT PRIMARY KEY, kind TEXT NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS gh_trend_ts ON gh_trend (ts)");
  }

  /**
   * 按 k 去重, 内容没变不写; full 时删掉这次没出现的新建仓库 / star; 返回写入行数。
   * 超出保留期的行 (新建仓库 / star 除外) 不写: 写了也会被同一次清理删掉, 每次同步白白一插一删 (#145)。
   */
  put(rows: TrendRow[], full: boolean, now: number): number {
    let n = 0;
    const cut = now - KEEP_MS;
    for (const r of rows) {
      if (r.ts < cut && !KEPT.includes(r.kind)) continue;
      n += this.sql.exec("INSERT INTO gh_trend (k, kind, ts, body) VALUES (?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET ts = excluded.ts, body = excluded.body WHERE body != excluded.body OR ts != excluded.ts", r.k, r.kind, r.ts, JSON.stringify(r.body)).rowsWritten;
    }
    if (full) {
      for (const kind of KEPT) {
        const keep = new Set(rows.filter((r) => r.kind === kind).map((r) => r.k));
        for (const o of this.sql.exec<{ k: string }>("SELECT k FROM gh_trend WHERE kind = ?", kind).toArray()) if (!keep.has(o.k)) n += this.sql.exec("DELETE FROM gh_trend WHERE k = ?", o.k).rowsWritten;
      }
    }
    n += this.sql.exec(`DELETE FROM gh_trend WHERE ts < ? AND kind NOT IN (${KEPT.map(() => "?").join(", ")})`, now - KEEP_MS, ...KEPT).rowsWritten;
    return n;
  }

  since(ts: number): TrendRow[] {
    return this.sql.exec<Row>("SELECT k, kind, ts, body FROM gh_trend WHERE ts >= ?", ts).toArray().map((r) => ({ k: r.k, kind: r.kind, ts: r.ts, body: JSON.parse(r.body) }));
  }

  footprints(kind: "repo" | "star"): TrendRow[] {
    return this.sql.exec<Row>("SELECT k, kind, ts, body FROM gh_trend WHERE kind = ? ORDER BY ts DESC LIMIT ?", kind, FOOTPRINT_LIMIT).toArray().map((r) => ({ k: r.k, kind: r.kind, ts: r.ts, body: JSON.parse(r.body) }));
  }

  clear(): number {
    return this.sql.exec("DELETE FROM gh_trend").rowsWritten;
  }
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * 同步一轮: 第一页带全部 (提交, 评审, 新建仓库, star, 最近评论, 我开的 Issue / PR), 之后几页只往前翻
 * 更早的评论与我开的 Issue / PR, 直到翻完或用完 pages。state 原地更新; 返回写入行数。
 */
export async function trendStep(store: TrendStore, token: string, state: TrendState, now: number, pages: number, fetcher: TrendFetcher = fetchTrend): Promise<number> {
  let wrote = 0;
  for (let i = 0; i < Math.max(1, pages); i++) {
    const full = i === 0;
    const older = !state.cmtDone && Boolean(state.before);
    const bi = !state.iDone;
    const bp = !state.pDone;
    if (!full && !older && !bi && !bp) break;
    // to 放到明天: 今天的提交在 GitHub 那边记在 "今天 (提交者本地日期) 太平洋零点", 可能晚于现在
    // 贡献集合只拉保留期内的: 拉一年的话一大半是马上要删的旧提交 (#145)
    const data = await fetcher(token, { from: iso(now - KEEP_MS), to: iso(now + DAY_MS), full, older, ...(older ? { before: state.before } : {}), back: bi || bp, bi, bp, ...(bi && state.ia ? { ia: state.ia } : {}), ...(bp && state.pa ? { pa: state.pa } : {}) });
    const page: TrendPage = parseTrend(data, full);
    wrote += store.put(page.rows, full, now);
    advance(state, page, now);
  }
  state.at = now;
  return wrote;
}

function advance(state: TrendState, page: TrendPage, now: number): void {
  advanceBack(state, page, now);
  const c = page.cmt;
  if (!c || state.cmtDone) return;
  if (c.before) state.before = c.before;
  if (!c.more || (c.oldest !== undefined && c.oldest < now - TREND_HORIZON_MS)) state.cmtDone = true;
}

/** 贡献集合往前翻: 没有游标时从最新一页起, 到底或翻过 HORIZON 就停。 */
function advanceBack(state: TrendState, page: TrendPage, now: number): void {
  const step = (b: TrendPage["ic"], done: boolean | undefined, set: (after: string | undefined, done: boolean) => void) => {
    if (!b || done) return;
    set(b.after, !b.more || !b.after || (b.oldest !== undefined && b.oldest < now - TREND_HORIZON_MS));
  };
  step(page.ic, state.iDone, (a, d) => ((state.ia = a ?? state.ia), (state.iDone = d)));
  step(page.pc, state.pDone, (a, d) => ((state.pa = a ?? state.pa), (state.pDone = d)));
}

/** 历史是否补完: 评论与我开的 Issue / PR 都翻到底。 */
export const trendDone = (st: TrendState | undefined): boolean => Boolean(st?.cmtDone && st.iDone && st.pDone);

const FIELDS = ["commits", "prOpened", "prMerged", "prClosed", "issueOpened", "issueClosed", "issueDropped", "prComments", "issueComments", "reviews"] as const;
type Field = (typeof FIELDS)[number];

const zero = (label: string): GithubTrendPoint => ({ label, commits: 0, prOpened: 0, prMerged: 0, prClosed: 0, issueOpened: 0, issueClosed: 0, issueDropped: 0, prComments: 0, issueComments: 0, reviews: 0 });

/** 一行拆成 (日期, 字段, 数): 提交直接用 GitHub 给的日期, 其余按 labelOf 换成本地日期。 */
export function eventsOf(r: TrendRow, labelOf: (ts: number) => string): [string, Field, number][] {
  const b = r.body;
  const t = (v: unknown) => (typeof v === "number" && v > 0 ? labelOf(v) : "");
  const out: [string, Field, number][] = [];
  const add = (d: string, f: Field, n = 1) => d && out.push([d, f, n]);
  switch (r.kind) {
    case "commit":
      add(String(b.day ?? ""), "commits", Number(b.n) || 0);
      break;
    case "issue":
      add(t(b.c), "issueOpened");
      add(t(b.x), b.no ? "issueDropped" : "issueClosed");
      break;
    case "pr":
      add(t(b.c), "prOpened");
      if (b.m) add(t(b.m), "prMerged");
      else add(t(b.x), "prClosed");
      break;
    case "cmt":
      add(labelOf(r.ts), b.pr ? "prComments" : "issueComments");
      break;
    case "review":
      add(labelOf(r.ts), "reviews");
      break;
  }
  return out;
}

/** 把行按 slot (日期 → 第几格, 不在范围内为 -1) 累加; received 是范围内新开的 Issue / PR 收到的评论总数。 */
export function seriesOf(rows: TrendRow[], labels: string[], slot: (date: string) => number, labelOf: (ts: number) => string): GithubTrendSeries {
  const points = labels.map(zero);
  let received = 0;
  for (const r of rows) {
    for (const [d, f, n] of eventsOf(r, labelOf)) {
      const p = points[slot(d)];
      if (p) p[f] += n;
    }
    if ((r.kind === "issue" || r.kind === "pr") && slot(labelOf(Number(r.body.c))) >= 0) received += Number(r.body.cm) || 0;
  }
  return { points, received };
}

const dayNo = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** 最近 14 天 (按天) 与最近 12 周 (周一起, 按周), today 为本地日期。 */
export function trendOf(rows: TrendRow[], today: string, labelOf: (ts: number) => string): { days: GithubTrendSeries; weeks: GithubTrendSeries } {
  const days = lastDates(today, GITHUB_TREND_DAYS);
  const first = dayNo(days[0] as string);
  const daySeries = seriesOf(rows, days, (d) => {
    const i = dayNo(d) - first;
    return i < GITHUB_TREND_DAYS ? i : -1;
  }, labelOf);
  const monday = dayNo(today) - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % WEEK);
  const w0 = monday - (GITHUB_TREND_WEEKS - 1) * WEEK;
  const weeks = Array.from({ length: GITHUB_TREND_WEEKS }, (_, k) => new Date((w0 + k * WEEK) * DAY_MS).toISOString().slice(0, 10));
  const weekSeries = seriesOf(rows, weeks, (d) => {
    const n = dayNo(d) - w0;
    return n >= 0 && n <= dayNo(today) - w0 ? Math.floor(n / WEEK) : -1;
  }, labelOf);
  return { days: daySeries, weeks: weekSeries };
}

/** 窗口内最早要读的行: 12 周的第一天往前一天, 防时区差。 */
export const trendSince = (now: number) => now - (GITHUB_TREND_WEEKS * WEEK + 1) * DAY_MS;

export function footprintOf(r: TrendRow): GithubFootprint {
  const b = r.body;
  const f: GithubFootprint = { repo: String(b.repo ?? ""), url: String(b.url ?? ""), at: r.ts };
  if (b.d) f.description = String(b.d);
  if (b.p === true) f.private = true;
  if (typeof b.s === "number") f.stars = b.s;
  if (b.f === true) f.fork = true;
  if (b.f === true && b.up) f.parent = String(b.up);
  return f;
}
