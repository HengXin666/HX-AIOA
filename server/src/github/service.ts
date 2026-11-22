import type { GithubRepoDetail, GithubReposResult, GithubSyncResult } from "@hx-aioa/protocol";
import { KV_GITHUB_SYNCED } from "../constants";
import type { Env } from "../env";
import type { Registry } from "../registry";
import { applyGithubEvent } from "./apply";
import { GithubStore, emptyMeta, repoKey } from "./store";
import { syncGithub, trackedRepos } from "./sync";

// GitHub 页面状态: webhook 增量更新, 有 GITHUB_TOKEN 时可回填
export class GithubService {
  readonly store: GithubStore;

  constructor(
    private readonly env: Env,
    sql: SqlStorage,
    private readonly storage: DurableObjectStorage,
    private readonly registry: Registry,
  ) {
    this.store = new GithubStore(sql);
  }

  apply(kind: string, body: unknown): void {
    try {
      applyGithubEvent(this.store, kind, body);
    } catch (e) {
      console.error("GitHub 状态更新失败:", kind, e);
    }
  }

  async repos(): Promise<GithubReposResult> {
    const now = Date.now();
    const repos = trackedRepos(this.store, this.registry).map((r) => this.store.summary(this.store.meta(r) ?? emptyMeta(r, now)));
    repos.sort((a, b) => b.updatedAt - a.updatedAt);
    const synced = Boolean(this.env.GITHUB_TOKEN) && Boolean(await this.storage.get<number>(KV_GITHUB_SYNCED));
    return { repos, synced };
  }

  detail(repo: string): GithubRepoDetail | null {
    const meta = this.store.meta(repo);
    if (meta) return this.store.detail(meta);
    const known = trackedRepos(this.store, this.registry).find((r) => repoKey(r) === repoKey(repo));
    return known ? this.store.detail(emptyMeta(known, Date.now())) : null;
  }

  async sync(): Promise<GithubSyncResult | null> {
    const token = this.env.GITHUB_TOKEN;
    if (!token) return null;
    const r = await syncGithub(this.store, this.registry, token);
    if (r.repos > 0) await this.storage.put(KV_GITHUB_SYNCED, Date.now());
    return r;
  }
}

