import type {
  GithubActivityResult,
  GithubBranchesResult,
  GithubAvailableResult,
  GithubDailyResult,
  GithubRepoDetail,
  GithubReposResult,
  GithubSyncResult,
} from "@hx-aioa/protocol";
import { KV_GITHUB_ACTIVITY_ETAG, KV_GITHUB_ACTIVITY_SYNCED, KV_GITHUB_LOGIN, KV_GITHUB_PICKS, KV_GITHUB_SYNCED } from "../constants";
import type { Env } from "../env";
import type { Registry } from "../registry";
import { fetchActivity, fetchAvailable, fetchLogin } from "./account";
import { ActivityStore, statsOf } from "./activity";
import { applyGithubEvent } from "./apply";
import { fetchBranches } from "./branches";
import { cfCached } from "../cf-cache";
import { dailyOf, dayStart, streakOf } from "./daily";
import { GithubStore, emptyMeta, repoKey } from "./store";
import { type Picks, syncGithub, trackedRepos } from "./sync";

const NO_PICKS: Picks = { picks: [], hidden: [] };
// 分支状况 10 分钟缓存 (内存 + 边缘), 下拉刷新可跳过
const BRANCH_CACHE_MS = 10 * 60_000;
const GUESS_BASE = "main";

// GitHub 页面状态: webhook 增量更新, 有 GITHUB_TOKEN 时可回填, 并拉取本人的动态
export class GithubService {
  readonly store: GithubStore;
  private readonly activityStore: ActivityStore;

  constructor(
    private readonly env: Env,
    sql: SqlStorage,
    private readonly storage: DurableObjectStorage,
    private readonly registry: Registry,
  ) {
    this.store = new GithubStore(sql);
    this.activityStore = new ActivityStore(sql);
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
    const n = this.store.clear() + this.activityStore.clear();
    await this.storage.delete([KV_GITHUB_PICKS, KV_GITHUB_LOGIN, KV_GITHUB_SYNCED, KV_GITHUB_ACTIVITY_ETAG, KV_GITHUB_ACTIVITY_SYNCED]);
    return n;
  }

  async sync(): Promise<GithubSyncResult | null> {
    const token = this.env.GITHUB_TOKEN;
    if (!token) return null;
    const [r, actErr] = await Promise.all([syncGithub(this.store, this.registry, token, await this.choice()), this.syncActivity(token)]);
    if (r.repos > 0) await this.storage.put(KV_GITHUB_SYNCED, Date.now());
    if (actErr) {
      r.ok = false;
      r.error = r.error ? `${r.error}; ${actErr}` : actErr;
    }
    return r;
  }
}
