import type { GithubTimelineKind } from "@hx-aioa/protocol";
import { s } from "../adapters/types";
import { type GithubStore, type RepoMeta, emptyMeta } from "./store";
import { type Obj, issueOf, num, obj, prOf, runOf } from "./map";
import { GITHUB_BRANCHES } from "../constants";

type Ctx = { store: GithubStore; repo: string; meta: RepoMeta; body: Obj; action: string; now: number };

const HEADS = "refs/heads/";
const SHA_SHORT = 7;
const CLOSED = "closed";
const OPENED = "opened";
const REOPENED = "reopened";
const PR_UPSERT = new Set([OPENED, REOPENED, "ready_for_review", "converted_to_draft", "edited", "synchronize"]);
const ISSUE_UPSERT = new Set([OPENED, REOPENED, "edited", "labeled", "unlabeled"]);
const ISSUE_GONE = new Set([CLOSED, "deleted", "transferred"]);
const ACTION_TEXT: Record<string, string> = { [OPENED]: "已打开", [REOPENED]: "已重新打开", [CLOSED]: "已关闭", merged: "已合并", ready_for_review: "可以 review" };

function note(c: Ctx, kind: GithubTimelineKind, title: string, url: string): void {
  c.store.addTimeline(c.repo, { ts: c.now, kind, title, url });
}

function push(c: Ctx): void {
  const commits = Array.isArray(c.body.commits) ? c.body.commits.length : 0;
  const ref = s(c.body.ref);
  if (!ref.startsWith(HEADS)) return;
  const branch = ref.slice(HEADS.length);
  const others = (c.meta.branches ?? []).filter((b) => b.branch !== branch);
  // 删分支: 从活跃列表拿掉, 免得留下死分支
  if (c.body.deleted === true) {
    c.meta.branches = others;
    note(c, "push", `删除分支 ${branch}`, s(obj(c.body.repository).html_url));
    return;
  }
  if (!commits) return;
  const by = s(obj(c.body.pusher).name) || s(obj(c.body.sender).login);
  const sha = s(c.body.after).slice(0, SHA_SHORT);
  c.meta.lastPush = { at: c.now, by, branch, commits, ...(sha ? { sha } : {}) };
  c.meta.branches = [c.meta.lastPush, ...others].slice(0, GITHUB_BRANCHES);
  note(c, "push", `${by} 推送 ${commits} 个提交到 ${branch}`, s(c.body.compare));
}

function pullRequest(c: Ctx): void {
  const raw = obj(c.body.pull_request);
  const pr = prOf(raw, c.now);
  if (!pr.number) return;
  if (c.action === CLOSED) c.store.deletePr(c.repo, pr.number);
  else if (PR_UPSERT.has(c.action)) c.store.putPr(c.repo, pr);
  const label = c.action === CLOSED && raw.merged === true ? "merged" : c.action;
  const text = ACTION_TEXT[label];
  if (text) note(c, "pr", `PR #${pr.number} ${pr.title} (${text})`, pr.url);
}

function issues(c: Ctx): void {
  const raw = obj(c.body.issue);
  if (raw.pull_request !== undefined) return;
  const issue = issueOf(raw, c.now);
  if (!issue.number) return;
  const existed = c.store.hasIssue(c.repo, issue.number);
  if (ISSUE_GONE.has(c.action)) {
    c.store.deleteIssue(c.repo, issue.number);
    c.meta.openIssues = Math.max(0, c.meta.openIssues - 1);
  } else if (ISSUE_UPSERT.has(c.action)) {
    c.store.putIssue(c.repo, issue);
    if (!existed && (c.action === OPENED || c.action === REOPENED)) c.meta.openIssues += 1;
  }
  const text = ACTION_TEXT[c.action];
  if (text) note(c, "issue", `Issue #${issue.number} ${issue.title} (${text})`, issue.url);
}

function workflowRun(c: Ctx): void {
  const raw = obj(c.body.workflow_run);
  const rid = s(raw.id);
  if (!rid) return;
  const run = runOf(raw, c.now);
  c.store.putRun(c.repo, rid, run);
  if (c.action === "completed") note(c, "ci", `CI ${run.workflow} @${run.branch}: ${s(raw.conclusion) || run.status}`, run.url);
}

function release(c: Ctx): void {
  const r = obj(c.body.release);
  if (c.action === "published") note(c, "release", `发布 ${s(r.tag_name)} ${s(r.name)}`.trim(), s(r.html_url));
}

function star(c: Ctx): void {
  if (c.action === "created") note(c, "star", `收到 star (${c.meta.stars})`, c.meta.url);
}

function comment(c: Ctx): void {
  const issue = obj(c.body.issue);
  const cm = obj(c.body.comment);
  if (c.action === "created") note(c, "comment", `${s(obj(cm.user).login)} 评论了 #${s(issue.number)} ${s(issue.title)}`, s(cm.html_url));
}

// ping 登记仓库; GitHub 的 open_issues_count 含 PR, 减去已知 PR 作为 Issue 计数的初值
function ping(c: Ctx, repository: Obj): void {
  const open = num(repository.open_issues_count);
  if (open !== undefined) c.meta.openIssues = Math.max(0, open - c.store.prCount(c.repo));
}

const HANDLERS: Record<string, (c: Ctx) => void> = { push, pull_request: pullRequest, issues, workflow_run: workflowRun, release, star, issue_comment: comment };

function mergeMeta(meta: RepoMeta, repository: Obj): void {
  const stars = num(repository.stargazers_count);
  if (stars !== undefined) meta.stars = stars;
  const url = s(repository.html_url);
  if (url) meta.url = url;
  if ("description" in repository) {
    const d = s(repository.description);
    if (d) meta.description = d;
    else delete meta.description;
  }
  const branch = s(repository.default_branch);
  if (branch) meta.defaultBranch = branch;
  // webhook 只带 fork 布尔值不带上游, 上游等同步补
  if (repository.fork === false) {
    delete meta.fork;
    delete meta.parent;
  } else if (repository.fork === true) meta.fork = true;
}

// webhook 入库时同步更新 GitHub 页面状态, 只处理带 repository.full_name 的事件
export function applyGithubEvent(store: GithubStore, kind: string, body: unknown, now = Date.now()): void {
  const b = obj(body);
  const repository = obj(b.repository);
  const repo = s(repository.full_name);
  if (!repo.includes("/")) return;
  const handler = HANDLERS[kind];
  if (!handler && kind !== "ping") return;
  const meta = store.meta(repo) ?? emptyMeta(repo, now);
  meta.repo = repo;
  mergeMeta(meta, repository);
  const c: Ctx = { store, repo, meta, body: b, action: s(b.action), now };
  if (handler) handler(c);
  else ping(c, repository);
  meta.updatedAt = now;
  store.saveMeta(meta);
}
