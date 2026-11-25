import type { GithubActivityItem, GithubActivityKind, GithubActivityStats } from "@hx-aioa/protocol";
import { s } from "../adapters/types";
import { GITHUB_WEB } from "../constants";
import { type Obj, num, obj } from "./map";

const KEEP_MS = 30 * 24 * 3600_000;
type Row = { body: string };

const tsOf = (raw: unknown) => Date.parse(s(raw)) || 0;

const ACTIONS: Record<string, string> = { opened: "打开", closed: "关闭", merged: "合并", reopened: "重新打开", created: "创建", published: "发布", edited: "编辑" };
const verb = (a: string) => ACTIONS[a] ?? a;
const join = (...parts: string[]) => parts.filter(Boolean).join(" ");

// GitHub 用户事件 → 一行动态; 2025 年起事件载荷精简 (推送不带提交, PR 不带标题), 缺的字段用分支与编号补
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
  const prNo = num(p.number) ?? num(pr.number);
  const prUrl = s(pr.html_url) || (prNo ? `${repoUrl}/pull/${prNo}` : repoUrl);
  const prRefs = s(obj(pr.head).ref) && s(obj(pr.base).ref) ? `(${s(obj(pr.head).ref)} → ${s(obj(pr.base).ref)})` : "";
  switch (s(e.type)) {
    case "PushEvent": {
      const branch = s(p.ref).replace(/^refs\/heads\//, "");
      const commits = num(p.size) ?? (Array.isArray(p.commits) ? p.commits.length : undefined);
      const head = s(p.head);
      const before = s(p.before);
      const last = obj(Array.isArray(p.commits) ? p.commits.at(-1) : undefined);
      const msg = s(last.message).split("\n")[0] ?? "";
      const title = `推送到 ${branch}${commits ? ` (${commits} 个提交)` : ""}${msg ? `: ${msg}` : ""}`;
      const url = before && head ? `${repoUrl}/compare/${before.slice(0, 12)}...${head.slice(0, 12)}` : head ? `${repoUrl}/commit/${head}` : repoUrl;
      return item("push", title, url, commits ? { commits } : {});
    }
    case "PullRequestEvent": {
      const action = s(p.action) === "closed" && pr.merged === true ? "merged" : s(p.action);
      return item("pr", join(verb(action), `PR #${prNo ?? ""}`, s(pr.title) || prRefs), prUrl, action ? { action } : {});
    }
    case "PullRequestReviewEvent":
      return item("review", join("评审", `PR #${prNo ?? ""}`, s(pr.title)), s(obj(p.review).html_url) || prUrl);
    case "PullRequestReviewCommentEvent":
    case "IssueCommentEvent":
    case "CommitCommentEvent": {
      const c = obj(p.comment);
      const target = num(issue.number) ?? prNo;
      return item("comment", join("评论", target ? `#${target}` : "", s(issue.title) || s(pr.title)), s(c.html_url) || repoUrl);
    }
    case "IssuesEvent": {
      const n = num(issue.number) ?? num(p.number);
      const action = s(p.action);
      return item("issue", join(verb(action), `Issue #${n ?? ""}`, s(issue.title)), s(issue.html_url) || (n ? `${repoUrl}/issues/${n}` : repoUrl), action ? { action } : {});
    }
    case "CreateEvent":
      return item("create", join("创建", s(p.ref_type), s(p.ref)), repoUrl);
    case "DeleteEvent":
      return item("delete", join("删除", s(p.ref_type), s(p.ref)), repoUrl);
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


// 一行一个事件, 按 id 去重, 内容没变的不重写
export class ActivityStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS gh_activity (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS gh_activity_ts ON gh_activity (ts)");
  }

  add(items: GithubActivityItem[], now = Date.now()): number {
    let n = 0;
    for (const i of items) n += this.sql.exec("INSERT INTO gh_activity (id, ts, body) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body WHERE body != excluded.body", i.id, i.ts, JSON.stringify(i)).rowsWritten;
    this.sql.exec("DELETE FROM gh_activity WHERE ts < ?", now - KEEP_MS);
    return n;
  }

  clear(): number {
    return this.sql.exec("DELETE FROM gh_activity").rowsWritten;
  }

  range(since: number, until: number): GithubActivityItem[] {
    return this.sql
      .exec<Row>("SELECT body FROM gh_activity WHERE ts >= ? AND ts < ? ORDER BY ts DESC LIMIT 500", since, until)
      .toArray()
      .map((r) => JSON.parse(r.body) as GithubActivityItem);
  }
}
