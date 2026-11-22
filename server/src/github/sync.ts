import type { GithubSyncResult } from "@hx-aioa/protocol";
import { s } from "../adapters/types";
import {
  GITHUB_ADAPTER,
  GITHUB_API,
  GITHUB_PAGE_SIZE,
  GITHUB_SYNC_MAX_REPOS,
  GITHUB_SYNC_RUNS,
  GITHUB_USER_AGENT,
} from "../constants";
import type { Registry } from "../registry";
import { type Obj, issueOf, num, obj, prOf, repoOfSubject, runOf } from "./map";
import { type GithubStore, emptyMeta, repoKey } from "./store";

// 仓库来源 = 所有 type=github 数据源的 subject + 收到过 webhook 的仓库, 按小写去重
export type Picks = { picks: string[]; hidden: string[] };

// 加上手动勾选的, 减去手动取消的
export function trackedRepos(store: GithubStore, registry: Registry, choice: Picks = { picks: [], hidden: [] }): string[] {
  const out = new Map<string, string>();
  for (const r of choice.picks) out.set(repoKey(r), r);
  for (const m of store.metas()) out.set(repoKey(m.repo), m.repo);
  for (const src of registry.sources()) {
    if (src.type !== GITHUB_ADAPTER) continue;
    const repo = repoOfSubject(src.subject);
    if (repo && !out.has(repoKey(repo))) out.set(repoKey(repo), repo);
  }
  for (const r of choice.hidden) if (!choice.picks.some((p) => repoKey(p) === repoKey(r))) out.delete(repoKey(r));
  return [...out.values()];
}

async function get(token: string, path: string): Promise<unknown> {
  const res = await fetch(GITHUB_API + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": GITHUB_USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} ${path}`);
  return res.json();
}

const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

async function syncRepo(store: GithubStore, token: string, repo: string, now: number): Promise<void> {
  const base = `/repos/${repo}`;
  const [info, pulls, issues, runs] = await Promise.all([
    get(token, base),
    get(token, `${base}/pulls?state=open&per_page=${GITHUB_PAGE_SIZE}`),
    get(token, `${base}/issues?state=open&per_page=${GITHUB_PAGE_SIZE}`),
    get(token, `${base}/actions/runs?per_page=${GITHUB_SYNC_RUNS}`),
  ]);
  const r = obj(info);
  const full = s(r.full_name) || repo;
  const meta = store.meta(full) ?? emptyMeta(full, now);
  meta.repo = full;
  meta.url = s(r.html_url) || meta.url;
  meta.stars = num(r.stargazers_count) ?? meta.stars;
  const d = s(r.description);
  if (d) meta.description = d;
  else delete meta.description;
  const branch = s(r.default_branch);
  if (branch) meta.defaultBranch = branch;
  // /issues 接口会混入 PR, 带 pull_request 字段的要排除
  const realIssues = list(issues).filter((i) => i.pull_request === undefined).map((i) => issueOf(i, now));
  store.replacePrs(full, list(pulls).map((p) => prOf(p, now)));
  store.replaceIssues(full, realIssues);
  for (const run of list(obj(runs).workflow_runs)) {
    const rid = s(run.id);
    if (rid) store.putRun(full, rid, runOf(run, now));
  }
  meta.openIssues = realIssues.length;
  meta.updatedAt = now;
  store.saveMeta(meta);
}

// 免费计划每次调用最多 50 个子请求, 每个仓库 4 个, 所以单次最多同步 GITHUB_SYNC_MAX_REPOS 个
export async function syncGithub(store: GithubStore, registry: Registry, token: string, choice: Picks, now = Date.now()): Promise<GithubSyncResult> {
  // 超过单次上限时先同步最久没更新的, 几轮 cron 后全部覆盖
  const stale = (r: string) => store.meta(r)?.updatedAt ?? 0;
  const repos = trackedRepos(store, registry, choice).sort((a, b) => stale(a) - stale(b)).slice(0, GITHUB_SYNC_MAX_REPOS);
  const errors: string[] = [];
  let done = 0;
  for (const repo of repos) {
    try {
      await syncRepo(store, token, repo, now);
      done += 1;
    } catch (e) {
      errors.push(`${repo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const out: GithubSyncResult = { ok: errors.length === 0, repos: done };
  if (errors.length) out.error = errors.join("; ");
  return out;
}
