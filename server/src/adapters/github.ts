import type { EventInput } from "@hx-aioa/protocol";
import { type Adapter, INFO, NORMAL, RESOLVED, WARNING, event, isObj, s } from "./types";

const HEADER_EVENT = "X-GitHub-Event";
const CLOSED = "closed";

type Ctx = { repo: string; subject: string; channel: string; body: Record<string, unknown> };

function obj(v: unknown): Record<string, unknown> {
  return isObj(v) ? v : {};
}

function common(c: Ctx, extra: Partial<EventInput> = {}): Partial<EventInput> {
  return { subject: c.subject, channel: c.channel, ...extra };
}

function pullRequest(c: Ctx): EventInput[] {
  const pr = obj(c.body.pull_request);
  const action = s(c.body.action);
  const n = s(pr.number);
  const merged = pr.merged === true;
  const title = `PR #${n} ${s(pr.title)}`;
  const label = action === CLOSED ? (merged ? "已合并" : "已关闭") : action;
  const ex = common(c, { dedupeKey: `pr:${c.repo}#${n}` });
  if (action === "review_requested") ex.priority = "need_me";
  const status = action === CLOSED ? RESOLVED : "ongoing";
  return [event(`[${c.repo}] ${title} (${label})`, NORMAL, { ...ex, status, url: s(pr.html_url), summary: s(obj(pr.user).login) })];
}

function issues(c: Ctx): EventInput[] {
  const issue = obj(c.body.issue);
  const action = s(c.body.action);
  const n = s(issue.number);
  const status = action === CLOSED ? RESOLVED : "ongoing";
  const ex = common(c, { dedupeKey: `issue:${c.repo}#${n}` });
  return [event(`[${c.repo}] Issue #${n} ${s(issue.title)} (${action})`, NORMAL, { ...ex, status, url: s(issue.html_url) })];
}

function workflowRun(c: Ctx): EventInput[] {
  const run = obj(c.body.workflow_run);
  if (s(c.body.action) !== "completed") return [];
  const conclusion = s(run.conclusion);
  const ok = conclusion === "success" || conclusion === "skipped";
  const branch = s(run.head_branch);
  const name = s(run.name);
  const ex = common(c, { dedupeKey: `ci:${c.repo}:${name}:${branch}`, groupKey: `ci:${c.repo}` });
  if (!ok) ex.priority = "need_me";
  const title = `[${c.repo}] CI ${name} @${branch}: ${conclusion}`;
  return [event(title, ok ? INFO : WARNING, { ...ex, status: ok ? RESOLVED : "firing", url: s(run.html_url) })];
}

function push(c: Ctx): EventInput[] {
  const commits = Array.isArray(c.body.commits) ? c.body.commits.map(obj) : [];
  if (!commits.length) return [];
  const branch = s(c.body.ref).replace("refs/heads/", "");
  const lines = commits.slice(0, 10).map((x) => `- ${s(x.message).split("\n")[0]}`).join("\n");
  return [event(`[${c.repo}] ${s(obj(c.body.pusher).name)} 推送 ${commits.length} 个提交到 ${branch}`, INFO, { ...common(c), summary: lines, url: s(c.body.compare) })];
}

function comment(c: Ctx): EventInput[] {
  const issue = obj(c.body.issue);
  const cm = obj(c.body.comment);
  if (s(c.body.action) !== "created") return [];
  return [event(`[${c.repo}] ${s(obj(cm.user).login)} 评论了 #${s(issue.number)} ${s(issue.title)}`, NORMAL, { ...common(c), summary: s(cm.body), url: s(cm.html_url) })];
}

function release(c: Ctx): EventInput[] {
  const r = obj(c.body.release);
  if (s(c.body.action) !== "published") return [];
  return [event(`[${c.repo}] 发布 ${s(r.tag_name)} ${s(r.name)}`, INFO, { ...common(c), summary: s(r.body), url: s(r.html_url) })];
}

const HANDLERS: Record<string, (c: Ctx) => EventInput[]> = {
  pull_request: pullRequest,
  issues,
  workflow_run: workflowRun,
  push,
  issue_comment: comment,
  release,
  star: (c) => (s(c.body.action) === "created" ? [event(`[${c.repo}] 收到 star (${s(obj(c.body.repository).stargazers_count)})`, INFO, common(c))] : []),
  ping: (c) => [event(`[${c.repo}] GitHub Webhook 已连接`, INFO, common(c, { dedupeKey: "ping" }))],
};

export const github: Adapter = ({ body, headers }) => {
  if (!isObj(body)) return "GitHub 请求体必须是 JSON";
  const kind = headers.get(HEADER_EVENT) ?? "";
  const full = s(obj(body.repository).full_name) || s(obj(body.organization).login) || "github";
  const repo = full.split("/").pop() ?? full;
  const c: Ctx = { repo, subject: `github:${full}`, channel: `github/${repo.toLowerCase()}`, body };
  const handler = HANDLERS[kind];
  if (handler) return handler(c);
  return [event(`[${repo}] ${kind || "未知事件"} ${s(body.action)}`.trim(), INFO, common(c))];
};

export const GITHUB_EVENT_HEADER = HEADER_EVENT;
export const GITHUB_SIGNATURE_HEADER = "X-Hub-Signature-256";
