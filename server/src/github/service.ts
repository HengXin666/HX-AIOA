import type {
  GithubActivityResult,
  GithubBranchesResult,
  GithubAvailableResult,
  GithubDailyResult,
  GithubDay,
  GithubTrendResult,
  GithubHeatmap,
  GithubHistoryKind,
  GithubHistoryResult,
  GithubRepoDetail,
  GithubReposResult,
  GithubSyncResult,
} from "@hx-aioa/protocol";
import { GITHUB_SYNC_MAX_REPOS, KV_GITHUB_ACTIVITY_ETAG, KV_GITHUB_ACTIVITY_SYNCED, KV_GITHUB_HEATMAP, KV_GITHUB_LOGIN, KV_GITHUB_PICKS, KV_GITHUB_SYNCED } from "../constants";
import type { Env } from "../env";
import type { Registry } from "../registry";
import { fetchActivity, fetchAvailable, fetchLogin } from "./account";
import { ActivityStore, statsOf } from "./activity";
import { applyGithubEvent } from "./apply";
import { fetchBranches } from "./branches";
import { cfCached } from "../cf-cache";
import { dailyOf, dayStart, streakOf } from "./daily";
import { type HeatState, HeatYears, KV_HEAT_STATE, backfillOf, backfillStep, emptyState, noteDate, yearKey, yearOf } from "./backfill";
import { type LegacyHeat, commitsByDate, dateIn, heatDates } from "./heatmap";
import { HistoryFail, fetchHistory, historyTtl } from "./history";
import { calendarStep } from "./calendar";
import { type TrendState, TrendStore, emptyTrend, footprintOf, seriesOf, trendOf, trendSince, trendStep } from "./trend";
import { GithubStore, emptyMeta, repoKey } from "./store";
import { type Picks, syncGithub, trackedRepos } from "./sync";

const NO_PICKS: Picks = { picks: [], hidden: [] };
// 分支状况 10 分钟缓存 (内存 + 边缘), 下拉刷新可跳过
const BRANCH_CACHE_MS = 10 * 60_000;
const GUESS_BASE = "main";
const HEAT_SCAN_MS = 31 * 24 * 3600_000;
const HEAT_LIVE_MS = 2 * 24 * 3600_000;
// 每次回填最多拉几页 (一页一次 GitHub 调用): 每天 cron 一次; 同步每 30 分钟一次, 只用同步剩下的子请求额度
const HEAT_CRON_PAGES = 30;
const HEAT_SYNC_PAGES = 5;
// 免费计划每次调用 50 个子请求: 同步每个仓库 4 个, 再给动态, 待办同步, CF 额度检查留一些
const SUBREQUESTS = 50;
const SYNC_CALLS_PER_REPO = 4;
const SUBREQ_RESERVED = 12;
// 走势 (#142): 每次同步至少 1 次 GraphQL, 补历史时用剩余额度最多再翻 3 页
const KV_TREND = "githubTrend";
const TREND_PAGES = 4;
const MIN_MS = 60_000;

// GitHub 页面状态: webhook 增量更新, 有 GITHUB_TOKEN 时可回填, 并拉取本人的动态
export class GithubService {
  readonly store: GithubStore;
  private readonly activityStore: ActivityStore;
  private readonly trendStore: TrendStore;
  private heatLock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly env: Env,
    sql: SqlStorage,
    private readonly storage: DurableObjectStorage,
    private readonly registry: Registry,
  ) {
    this.store = new GithubStore(sql);
    this.activityStore = new ActivityStore(sql);
    this.trendStore = new TrendStore(sql);
  }

  apply(kind: string, body: unknown): void {
    try {
      applyGithubEvent(this.store, kind, body);
    } catch (e) {
      console.error("GitHub 状态更新失败:", kind, e);
    }
  }

  private async choice(): Promise<Picks> {
    return (await this.storage.get<Picks>(KV_GITHUB_PICKS)) ?? NO_PICKS;
  }

  private async tracked(): Promise<string[]> {
    return trackedRepos(this.store, this.registry, await this.choice());
  }

  async repos(): Promise<GithubReposResult> {
    const now = Date.now();
    const repos = (await this.tracked()).map((r) => this.store.summary(this.store.meta(r) ?? emptyMeta(r, now)));
    repos.sort((a, b) => b.updatedAt - a.updatedAt);
    const synced = Boolean(this.env.GITHUB_TOKEN) && Boolean(await this.storage.get<number>(KV_GITHUB_SYNCED));
    return { repos, synced };
  }

  async detail(repo: string): Promise<GithubRepoDetail | null> {
    const meta = this.store.meta(repo);
    if (meta) return this.store.detail(meta);
    const known = (await this.tracked()).find((r) => repoKey(r) === repoKey(repo));
    return known ? this.store.detail(emptyMeta(known, Date.now())) : null;
  }

  private async login(token: string): Promise<string> {
    const cached = await this.storage.get<string>(KV_GITHUB_LOGIN);
    if (cached) return cached;
    const login = await fetchLogin(token);
    await this.storage.put(KV_GITHUB_LOGIN, login);
    return login;
  }

  async available(): Promise<GithubAvailableResult | null> {
    const token = this.env.GITHUB_TOKEN;
    if (!token) return null;
    const [login, list, tracked] = await Promise.all([this.login(token), fetchAvailable(token), this.tracked()]);
    const keys = new Set(tracked.map(repoKey));
    return { login, repos: list.map((r) => ({ ...r, tracked: keys.has(repoKey(r.repo)) })) };
  }

  // 整体替换关注列表: 列表里的都显示, 之前显示但不在列表里的隐藏
  async setTracked(repos: string[]): Promise<GithubReposResult> {
    const before = await this.tracked();
    const keys = new Set(repos.map(repoKey));
    const hidden = before.filter((r) => !keys.has(repoKey(r)));
    await this.storage.put(KV_GITHUB_PICKS, { picks: repos, hidden } satisfies Picks);
    return this.repos();
  }

  async activity(since: number, until: number): Promise<GithubActivityResult> {
    const items = this.activityStore.range(since, until);
    const login = (await this.storage.get<string>(KV_GITHUB_LOGIN)) ?? "";
    const syncedAt = await this.storage.get<number>(KV_GITHUB_ACTIVITY_SYNCED);
    return { login, since, until, items, stats: statsOf(items), ...(syncedAt ? { syncedAt } : {}) };
  }

  /** 最近 days 天每天的提交 / PR / Issue, 加上关注仓库当前未处理的 PR 与 Issue。 */
  async daily(days: number, tz: number, now = Date.now()): Promise<GithubDailyResult> {
    const since = dayStart(now, tz) - (days - 1) * 24 * 3600_000;
    const list = dailyOf(this.activityStore.range(since, now + 60_000), now, days, tz);
    await this.dailyFromTrend(list, tz, since);
    const { repos } = await this.repos();
    const login = (await this.storage.get<string>(KV_GITHUB_LOGIN)) ?? "";
    const syncedAt = await this.storage.get<number>(KV_GITHUB_ACTIVITY_SYNCED);
    return {
      login,
      days: list,
      openPrs: repos.reduce((n, r) => n + r.openPrs, 0),
      openIssues: repos.reduce((n, r) => n + r.openIssues, 0),
      streak: streakOf(list),
      ...(syncedAt ? { syncedAt } : {}),
    };
  }

  /**
   * 事件 API 只有最近 300 条, 推送也不带提交数, 热闹时连两天都盖不住 (#142): 走势同步过后,
   * 提交 / PR / Issue / 评审 / 评论改用走势表的数, 推送次数仍来自动态。
   */
  private async dailyFromTrend(list: GithubDay[], tz: number, since: number): Promise<void> {
    if (!(await this.storage.get<TrendState>(KV_TREND))?.at) return;
    const labelOf = (ts: number) => new Date(ts + tz * MIN_MS).toISOString().slice(0, 10);
    const idx = new Map(list.map((d, i) => [d.day, i]));
    const s = seriesOf(this.trendStore.since(since - 24 * 3600_000), list.map((d) => d.day), (d) => idx.get(d) ?? -1, labelOf);
    s.points.forEach((p, i) => {
      const d = list[i];
      if (!d) return;
      Object.assign(d, { commits: p.commits, prOpened: p.prOpened, prMerged: p.prMerged, prClosed: p.prClosed, issueOpened: p.issueOpened, issueClosed: p.issueClosed, reviews: p.reviews, comments: p.prComments + p.issueComments });
    });
  }

  /**
   * 走势与 ETag (#142): 按天 14 格 + 按周 12 格 + 足迹, 只读库不调 GitHub; 同步时间与今天没变就 304。
   * 带 repo (#144) 只算这个仓库的行, 足迹为空, 给单仓库页的混合图。
   */
  async trend(tz: string, now = Date.now(), repo?: string): Promise<{ body: GithubTrendResult; tag: string }> {
    const st = await this.storage.get<TrendState>(KV_TREND);
    const login = (await this.storage.get<string>(KV_GITHUB_LOGIN)) ?? "";
    const today = dateIn(now, tz);
    const rows = this.trendStore.since(trendSince(now));
    const mine = repo ? rows.filter((r) => repoKey(String(r.body.repo ?? "")) === repoKey(repo)) : rows;
    const { days, weeks } = trendOf(mine, today, (ts) => dateIn(ts, tz));
    const body: GithubTrendResult = {
      login,
      days,
      weeks,
      created: repo ? [] : this.trendStore.footprints("repo").map(footprintOf),
      starred: repo ? [] : this.trendStore.footprints("star").map(footprintOf),
      backfill: { done: Boolean(st?.caught && st.cmtDone) },
      ...(st?.at ? { syncedAt: st.at } : {}),
    };
    return { body, tag: `t-${repo ? repoKey(repo) : ""}-${tz}-${today}-${st?.at ?? 0}` };
  }

  /** 走势同步: 一次 GraphQL 拿全, 补历史时多翻几页; 失败只记错误, 不影响仓库同步。 */
  private async syncTrend(token: string, pages: number, now = Date.now()): Promise<string | null> {
    try {
      const login = await this.login(token);
      const st = (await this.storage.get<TrendState>(KV_TREND)) ?? emptyTrend(now);
      await trendStep(this.trendStore, token, login, st, now, pages);
      await this.storage.put(KV_TREND, st);
      return null;
    } catch (e) {
      return `走势: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** 热力图状态与年份行的读改写串行执行, cron 与同步同时跑时不会重复累计。 */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.heatLock.then(fn, fn);
    this.heatLock = run.catch(() => undefined);
    return run;
  }

  /** 每天 cron (#134): 最近 31 天动态按天并进年份行, 有 token 时再回填 budget 页历史提交。 */
  refreshHeatmap(tz: string, now = Date.now(), budget = HEAT_CRON_PAGES): Promise<HeatState> {
    return this.serial(async () => {
      const state = (await this.storage.get<HeatState>(KV_HEAT_STATE)) ?? emptyState(now);
      state.tz = tz;
      const years = new HeatYears(this.storage);
      const legacy = await this.storage.get<LegacyHeat>(KV_GITHUB_HEATMAP);
      const events = [...commitsByDate(this.activityStore.pushes(now - HEAT_SCAN_MS), tz), ...Object.entries(legacy?.days ?? {})];
      await years.load(events.map(([d]) => yearOf(d)));
      for (const [d, n] of events) {
        years.add("e", d, n);
        noteDate(state, d);
      }
      await this.backfill(state, years, budget, now);
      state.updated = now;
      await this.storage.put({ ...years.changes(), [KV_HEAT_STATE]: state });
      if (legacy) await this.storage.delete(KV_GITHUB_HEATMAP);
      return state;
    });
  }

  private async backfill(state: HeatState, years: HeatYears, budget: number, now: number): Promise<void> {
    const token = this.env.GITHUB_TOKEN;
    if (!token) return;
    // 先用贡献日历一次铺满全部历史 (#140), 再按仓库慢慢补提交
    await calendarStep(token, state, years, now).catch((e) => console.error("贡献日历回填失败:", e));
    if (budget <= 0 || !state.tz) return;
    try {
      const login = await this.login(token);
      await backfillStep({ token, login, repos: await this.tracked(), state, years, tz: state.tz, budget, now });
    } catch (e) {
      console.error("热力图历史回填失败:", e);
    }
  }

  /** 同步时顺带回填几页; 还没算过热力图 (不知道时区) 时跳过, 没拉到东西不写。 */
  private heatSync(budget: number, now = Date.now()): Promise<void> {
    return this.serial(async () => {
      // 还没算过热力图也照样回填: 点同步就该看到全部历史 (#140)
      const state = (await this.storage.get<HeatState>(KV_HEAT_STATE)) ?? emptyState(now);
      const before = JSON.stringify(state.repos);
      const years = new HeatYears(this.storage);
      await this.backfill(state, years, budget, now);
      const changes = years.changes();
      if (!Object.keys(changes).length && JSON.stringify(state.repos) === before) return;
      state.updated = now;
      await this.storage.put({ ...changes, [KV_HEAT_STATE]: state });
    });
  }

  /** 热力图与 ETag: 年份行 + 最近两天的实时提交; 还没算过时当场算一次 (不调 GitHub)。year 为空时是最近 140 天。 */
  async heatmap(tz: string, now = Date.now(), year?: number): Promise<{ map: GithubHeatmap; tag: string }> {
    const state = (await this.storage.get<HeatState>(KV_HEAT_STATE)) ?? (await this.refreshHeatmap(tz, now, 0));
    const today = dateIn(now, tz);
    const dates = heatDates(today, year);
    const years = new HeatYears(this.storage);
    await years.load(dates.map(yearOf));
    const live = commitsByDate(this.activityStore.pushes(now - HEAT_LIVE_MS), tz);
    const days = dates.map((date) => ({ date, commits: Math.max(years.count(date), live.get(date) ?? 0) }));
    const thisYear = yearOf(today);
    const list = [...new Set([thisYear, ...state.years])].filter((y) => y <= thisYear).sort((a, b) => b - a);
    const map: GithubHeatmap = { days, updated: state.updated, years: list, backfill: backfillOf(state, await this.tracked()) };
    if (year) map.year = year;
    const sum = [...live.values()].reduce((a, b) => a + b, 0);
    // w: 最近窗口改成按周一补齐 (#144), 换个前缀让旧缓存失效
    return { map, tag: `w${year ?? 0}-${tz}-${today}-${state.updated}-${sum}` };
  }

  /** 仓库全部历史的一页 (#134): 只给关注的仓库, 按 (仓库, 类别, 游标) 放 Cache API, 不落库。 */
  async history(repo: string, kind: GithubHistoryKind, before: string, now = Date.now()): Promise<GithubHistoryResult | null> {
    const token = this.env.GITHUB_TOKEN;
    if (!token) return null;
    const known = (await this.tracked()).find((r) => repoKey(r) === repoKey(repo));
    if (!known) throw new HistoryFail(404, "没有关注这个仓库");
    return cfCached(`gh-hist:${repoKey(known)}:${kind}:${before}`, historyTtl(kind, before, now), now, () => fetchHistory(token, known, kind, before));
  }

  /** 关注仓库里最近 days 天活跃, 还没合入默认分支的分支。fresh 跳过缓存。 */
  async branches(days: number, fresh: boolean, now = Date.now()): Promise<GithubBranchesResult | null> {
    const token = this.env.GITHUB_TOKEN;
    if (!token) return null;
    return cfCached(`gh-branches:${days}`, fresh ? 0 : BRANCH_CACHE_MS, now, () => this.loadBranches(token, days, now));
  }

  private async loadBranches(token: string, days: number, now: number): Promise<GithubBranchesResult> {
    const ci = (repo: string, branch: string) => this.store.runs(repo).find((r) => r.branch === branch)?.status;
    const want = (await this.tracked()).map((repo) => ({ repo, base: this.store.meta(repo)?.defaultBranch ?? GUESS_BASE }));
    const repos = await fetchBranches(token, want, days, ci, now);
    // 默认分支猜错的 (还没同步过的仓库) 用查到的名字再查一次
    const redo = repos.flatMap((r, i) => (r.defaultBranch && r.defaultBranch !== want[i]?.base ? [{ i, repo: r.repo, base: r.defaultBranch }] : []));
    if (redo.length) {
      const again = await fetchBranches(token, redo, days, ci, now);
      redo.forEach((x, k) => (repos[x.i] = again[k]!));
    }
    repos.sort((a, b) => (b.branches[0]?.at ?? 0) - (a.branches[0]?.at ?? 0));
    return { at: now, days, repos };
  }

  private async syncActivity(token: string): Promise<string | null> {
    try {
      const login = await this.login(token);
      const etag = await this.storage.get<string>(KV_GITHUB_ACTIVITY_ETAG);
      const r = await fetchActivity(token, login, etag);
      if (r) {
        this.activityStore.add(r.items);
        if (r.etag) await this.storage.put(KV_GITHUB_ACTIVITY_ETAG, r.etag);
      }
      await this.storage.put(KV_GITHUB_ACTIVITY_SYNCED, Date.now());
      return null;
    } catch (e) {
      return `动态: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** 停用插件并清除数据: 表与关注列表, 登录名, 同步时间一起清掉; 返回删掉的行数。 */
  async purge(): Promise<number> {
    const n = this.store.clear() + this.activityStore.clear() + this.trendStore.clear();
    const heat = (await this.storage.get<HeatState>(KV_HEAT_STATE))?.years ?? [];
    const keys = [KV_GITHUB_PICKS, KV_GITHUB_LOGIN, KV_GITHUB_SYNCED, KV_GITHUB_ACTIVITY_ETAG, KV_GITHUB_ACTIVITY_SYNCED, KV_GITHUB_HEATMAP, KV_HEAT_STATE, KV_TREND];
    await this.storage.delete([...keys, ...heat.map(yearKey)]);
    return n;
  }

  async sync(): Promise<GithubSyncResult | null> {
    const token = this.env.GITHUB_TOKEN;
    if (!token) return null;
    const room = SUBREQUESTS - SYNC_CALLS_PER_REPO * Math.min((await this.tracked()).length, GITHUB_SYNC_MAX_REPOS) - SUBREQ_RESERVED;
    const pages = Math.max(1, Math.min(TREND_PAGES, room + 1));
    const [r, actErr, trendErr] = await Promise.all([syncGithub(this.store, this.registry, token, await this.choice()), this.syncActivity(token), this.syncTrend(token, pages)]);
    if (r.repos > 0) await this.storage.put(KV_GITHUB_SYNCED, Date.now());
    await this.heatSync(Math.max(0, Math.min(HEAT_SYNC_PAGES, room - pages + 1))).catch((e) => console.error("热力图回填失败:", e));
    for (const err of [actErr, trendErr]) {
      if (!err) continue;
      r.ok = false;
      r.error = r.error ? `${r.error}; ${err}` : err;
    }
    return r;
  }
}
