import type {
  GithubCi,
  GithubIssue,
  GithubPr,
  GithubPush,
  GithubRepoDetail,
  GithubRepoSummary,
  GithubRun,
  GithubTimelineItem,
} from "@hx-aioa/protocol";
import { GITHUB_KEEP, GITHUB_WEB } from "../constants";

// 仓库行只存 webhook / 同步得到的元信息, openPrs 与 ci 读取时由子表算出
export type RepoMeta = {
  repo: string;
  url: string;
  description?: string;
  stars: number;
  openIssues: number;
  defaultBranch?: string;
  lastPush?: GithubPush;
  updatedAt: number;
};

const PR = "gh_pr";
const ISSUE = "gh_issue";

type BodyRow = { body: string };
type Item = { number: number };

export const repoKey = (repo: string) => repo.toLowerCase();

export function emptyMeta(repo: string, now: number): RepoMeta {
  return { repo, url: `${GITHUB_WEB}/${repo}`, stars: 0, openIssues: 0, updatedAt: now };
}

// 写入少: 仓库按行覆盖, PR / Issue 按 number upsert 且内容不变时不写, runs 与 timeline 各留最近 30 条
export class GithubStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS gh_repo (k TEXT PRIMARY KEY, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS gh_pr (k TEXT NOT NULL, num INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (k, num))");
    sql.exec("CREATE TABLE IF NOT EXISTS gh_issue (k TEXT NOT NULL, num INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (k, num))");
    sql.exec("CREATE TABLE IF NOT EXISTS gh_run (k TEXT NOT NULL, rid TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (k, rid))");
    sql.exec("CREATE TABLE IF NOT EXISTS gh_tl (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS gh_tl_k ON gh_tl (k, ts)");
  }

  meta(repo: string): RepoMeta | null {
    const row = this.sql.exec<BodyRow>("SELECT body FROM gh_repo WHERE k = ?", repoKey(repo)).toArray()[0];
    return row ? (JSON.parse(row.body) as RepoMeta) : null;
  }

  metas(): RepoMeta[] {
    return this.sql.exec<BodyRow>("SELECT body FROM gh_repo ORDER BY k").toArray().map((r) => JSON.parse(r.body) as RepoMeta);
  }

  saveMeta(meta: RepoMeta): void {
    this.sql.exec("INSERT OR REPLACE INTO gh_repo (k, body) VALUES (?, ?)", repoKey(meta.repo), JSON.stringify(meta));
  }

  private items<T>(table: string, repo: string): T[] {
    return this.sql.exec<BodyRow>(`SELECT body FROM ${table} WHERE k = ? ORDER BY num DESC`, repoKey(repo)).toArray().map((r) => JSON.parse(r.body) as T);
  }

  private has(table: string, repo: string, num: number): boolean {
    return this.sql.exec(`SELECT 1 FROM ${table} WHERE k = ? AND num = ?`, repoKey(repo), num).toArray().length > 0;
  }

  private upsert(table: string, repo: string, item: Item): void {
    const body = JSON.stringify(item);
    const old = this.sql.exec<BodyRow>(`SELECT body FROM ${table} WHERE k = ? AND num = ?`, repoKey(repo), item.number).toArray()[0];
    if (old?.body === body) return;
    this.sql.exec(`INSERT OR REPLACE INTO ${table} (k, num, body) VALUES (?, ?, ?)`, repoKey(repo), item.number, body);
  }

  private remove(table: string, repo: string, num: number): void {
    this.sql.exec(`DELETE FROM ${table} WHERE k = ? AND num = ?`, repoKey(repo), num);
  }

  // 同步时整体替换: 只写变化的行, 删除已不再开放的
  private replace(table: string, repo: string, items: Item[]): void {
    const keep = new Set(items.map((i) => i.number));
    const nums = this.sql.exec<{ num: number }>(`SELECT num FROM ${table} WHERE k = ?`, repoKey(repo)).toArray();
    for (const r of nums) if (!keep.has(r.num)) this.remove(table, repo, r.num);
    for (const i of items) this.upsert(table, repo, i);
  }

  prs = (repo: string) => this.items<GithubPr>(PR, repo);
  hasPr = (repo: string, n: number) => this.has(PR, repo, n);
  putPr = (repo: string, pr: GithubPr) => this.upsert(PR, repo, pr);
  deletePr = (repo: string, n: number) => this.remove(PR, repo, n);
  replacePrs = (repo: string, prs: GithubPr[]) => this.replace(PR, repo, prs);

  issues = (repo: string) => this.items<GithubIssue>(ISSUE, repo);
  hasIssue = (repo: string, n: number) => this.has(ISSUE, repo, n);
  putIssue = (repo: string, issue: GithubIssue) => this.upsert(ISSUE, repo, issue);
  deleteIssue = (repo: string, n: number) => this.remove(ISSUE, repo, n);
  replaceIssues = (repo: string, issues: GithubIssue[]) => this.replace(ISSUE, repo, issues);

  prCount(repo: string): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM gh_pr WHERE k = ?", repoKey(repo)).one().n;
  }

  putRun(repo: string, rid: string, run: GithubRun): void {
    const body = JSON.stringify(run);
    const old = this.sql.exec<BodyRow>("SELECT body FROM gh_run WHERE k = ? AND rid = ?", repoKey(repo), rid).toArray()[0];
    if (old?.body === body) return;
    this.sql.exec("INSERT OR REPLACE INTO gh_run (k, rid, at, body) VALUES (?, ?, ?, ?)", repoKey(repo), rid, run.at, body);
    this.sql.exec("DELETE FROM gh_run WHERE k = ? AND rid NOT IN (SELECT rid FROM gh_run WHERE k = ? ORDER BY at DESC LIMIT ?)", repoKey(repo), repoKey(repo), GITHUB_KEEP);
  }

  runs(repo: string): GithubRun[] {
    return this.sql.exec<BodyRow>("SELECT body FROM gh_run WHERE k = ? ORDER BY at DESC LIMIT ?", repoKey(repo), GITHUB_KEEP).toArray().map((r) => JSON.parse(r.body) as GithubRun);
  }

  addTimeline(repo: string, item: GithubTimelineItem): void {
    this.sql.exec("INSERT INTO gh_tl (k, ts, body) VALUES (?, ?, ?)", repoKey(repo), item.ts, JSON.stringify(item));
    this.sql.exec("DELETE FROM gh_tl WHERE k = ? AND id NOT IN (SELECT id FROM gh_tl WHERE k = ? ORDER BY ts DESC, id DESC LIMIT ?)", repoKey(repo), repoKey(repo), GITHUB_KEEP);
  }

  timeline(repo: string): GithubTimelineItem[] {
    return this.sql.exec<BodyRow>("SELECT body FROM gh_tl WHERE k = ? ORDER BY ts DESC, id DESC LIMIT ?", repoKey(repo), GITHUB_KEEP).toArray().map((r) => JSON.parse(r.body) as GithubTimelineItem);
  }

  summary(meta: RepoMeta): GithubRepoSummary {
    const { lastPush, description, defaultBranch, ...rest } = meta;
    const out: GithubRepoSummary = { ...rest, openPrs: this.prCount(meta.repo) };
    if (description) out.description = description;
    if (defaultBranch) out.defaultBranch = defaultBranch;
    if (lastPush) out.lastPush = lastPush;
    const run = this.runs(meta.repo)[0];
    if (run) out.ci = { ...run } satisfies GithubCi;
    return out;
  }

  detail(meta: RepoMeta): GithubRepoDetail {
    const r = meta.repo;
    return { repo: this.summary(meta), prs: this.prs(r), issues: this.issues(r), runs: this.runs(r), timeline: this.timeline(r) };
  }
}
