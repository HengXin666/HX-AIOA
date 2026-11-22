import type { GithubActivityItem, GithubActivityKind, GithubActivityStats } from "@hx-aioa/protocol";
import { s } from "../adapters/types";
import { GITHUB_WEB } from "../constants";
import { type Obj, num, obj } from "./map";

const KEEP_MS = 30 * 24 * 3600_000;
type Row = { body: string };

const tsOf = (raw: unknown) => Date.parse(s(raw)) || 0;

// GitHub 用户事件 → 一行动态; 认不出的类型归为 other, 不丢
export function activityOf(e: Obj): GithubActivityItem | null {
  const id = s(e.id);
  const repo = s(obj(e.repo).name);
  if (!id || !repo) return null;
  const p = obj(e.payload);
  const repoUrl = `${GITHUB_WEB}/${repo}`;
  const base = { id, ts: tsOf(e.created_at), repo };
  const item = (kind: GithubActivityKind, title: string, url = repoUrl, extra: Partial<GithubActivityItem> = {}): GithubActivityItem => ({ ...base, kind, title, url, ...extra });
  const pr = obj(p.pull_request);
  const issue = obj(p.issue);
  switch (s(e.type)) {
    case "PushEvent": {
      const branch = s(p.ref).replace(/^refs\/heads\//, "");
      const commits = num(p.size) ?? (Array.isArray(p.commits) ? p.commits.length : 0);
      const head = s(p.head);
      const first = obj(Array.isArray(p.commits) ? p.commits.at(-1) : undefined);
      const msg = s(first.message).split("\n")[0];
      const title = `推送 ${commits} 个提交到 ${branch}${msg ? `: ${msg}` : ""}`;
      return item("push", title, head ? `${repoUrl}/commit/${head}` : repoUrl, { commits });
    }
    case "PullRequestEvent":
      return item("pr", `${s(p.action)} PR #${num(pr.number) ?? ""} ${s(pr.title)}`, s(pr.html_url) || repoUrl);
    case "PullRequestReviewEvent":
      return item("review", `评审 PR #${num(pr.number) ?? ""} ${s(pr.title)}`, s(obj(p.review).html_url) || s(pr.html_url) || repoUrl);
    case "PullRequestReviewCommentEvent":
    case "IssueCommentEvent":
    case "CommitCommentEvent": {
      const c = obj(p.comment);
      const target = num(issue.number) ?? num(pr.number);
      return item("comment", `评论${target ? ` #${target}` : ""} ${s(issue.title) || s(pr.title)}`.trim(), s(c.html_url) || repoUrl);
    }
    case "IssuesEvent":
      return item("issue", `${s(p.action)} Issue #${num(issue.number) ?? ""} ${s(issue.title)}`, s(issue.html_url) || repoUrl);
    case "CreateEvent":
      return item("create", `创建 ${s(p.ref_type)} ${s(p.ref)}`.trim(), repoUrl);
    case "DeleteEvent":
      return item("delete", `删除 ${s(p.ref_type)} ${s(p.ref)}`.trim(), repoUrl);
    case "ReleaseEvent": {
      const r = obj(p.release);
      return item("release", `发布 ${s(r.tag_name) || s(r.name)}`, s(r.html_url) || repoUrl);
    }
    case "WatchEvent":
      return item("star", "加星", repoUrl);
    case "ForkEvent":
      return item("fork", "Fork", s(obj(p.forkee).html_url) || repoUrl);
    default:
      return item("other", s(e.type).replace(/Event$/, ""), repoUrl);
  }
}

export function statsOf(items: GithubActivityItem[]): GithubActivityStats {
  const repos = new Set<string>();
  const st: GithubActivityStats = { pushes: 0, commits: 0, prs: 0, issues: 0, comments: 0, repos: 0 };
  for (const i of items) {
    repos.add(i.repo);
    if (i.kind === "push") {
      st.pushes += 1;
      st.commits += i.commits ?? 0;
    } else if (i.kind === "pr" || i.kind === "review") st.prs += 1;
    else if (i.kind === "issue") st.issues += 1;
    else if (i.kind === "comment") st.comments += 1;
  }
  st.repos = repos.size;
  return st;
}


// 一行一个事件, 按 id 去重, 已有的不再写
export class ActivityStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS gh_activity (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, body TEXT NOT NULL)");
  }

  add(items: GithubActivityItem[], now = Date.now()): number {
    let n = 0;
    for (const i of items) n += this.sql.exec("INSERT OR IGNORE INTO gh_activity (id, ts, body) VALUES (?, ?, ?)", i.id, i.ts, JSON.stringify(i)).rowsWritten;
    this.sql.exec("DELETE FROM gh_activity WHERE ts < ?", now - KEEP_MS);
    return n;
  }

  range(since: number, until: number): GithubActivityItem[] {
    return this.sql
      .exec<Row>("SELECT body FROM gh_activity WHERE ts >= ? AND ts < ? ORDER BY ts DESC LIMIT 500", since, until)
      .toArray()
      .map((r) => JSON.parse(r.body) as GithubActivityItem);
  }
}
