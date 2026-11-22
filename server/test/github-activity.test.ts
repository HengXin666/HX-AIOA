import assert from "node:assert/strict";
import { test } from "node:test";
import { activityOf, statsOf } from "../src/github/activity";

const REPO = "HengXin666/HX-AIOA";
const AT = "2026-11-22T10:00:00Z";
const ev = (type: string, payload: Record<string, unknown>, id = type) => ({ id, type, created_at: AT, repo: { name: REPO }, payload });

test("推送事件: 分支, 提交数, 最新提交信息", () => {
  const a = activityOf(ev("PushEvent", { ref: "refs/heads/main", size: 2, head: "abc123", commits: [{ message: "旧" }, { message: "多账号\n细节" }] }));
  assert.equal(a?.kind, "push");
  assert.equal(a?.commits, 2);
  assert.equal(a?.title, "推送到 main (2 个提交): 多账号");
  assert.equal(a?.url, `https://github.com/${REPO}/commit/abc123`);
  assert.equal(a?.ts, Date.parse(AT));
});

test("PR, Issue, 评论, 未知类型", () => {
  assert.equal(activityOf(ev("PullRequestEvent", { action: "opened", pull_request: { number: 20, title: "多账号", html_url: "u" } }))?.title, "打开 PR #20 多账号");
  assert.equal(activityOf(ev("IssuesEvent", { action: "closed", issue: { number: 8, title: "耗电" } }))?.kind, "issue");
  assert.equal(activityOf(ev("IssueCommentEvent", { issue: { number: 8, title: "耗电" }, comment: { html_url: "c" } }))?.url, "c");
  assert.equal(activityOf(ev("GollumEvent", {}))?.kind, "other");
  assert.equal(activityOf({ id: "x", type: "PushEvent", payload: {} }), null);
});

test("精简载荷: 推送没有提交, PR 没有标题", () => {
  const push = activityOf(ev("PushEvent", { ref: "refs/heads/main", before: "9a27b422b6095a8a", head: "a096eef2a2a1efad" }));
  assert.equal(push?.title, "推送到 main");
  assert.equal(push?.commits, undefined);
  assert.equal(push?.url, `https://github.com/${REPO}/compare/9a27b422b609...a096eef2a2a1`);
  const pr = activityOf(ev("PullRequestEvent", { action: "merged", number: 22, pull_request: { head: { ref: "hark/x" }, base: { ref: "main" } } }));
  assert.equal(pr?.title, "合并 PR #22 (hark/x → main)");
  assert.equal(pr?.url, `https://github.com/${REPO}/pull/22`);
});

test("统计", () => {
  const items = [
    activityOf(ev("PushEvent", { ref: "refs/heads/main", size: 3 }, "1")),
    activityOf(ev("PushEvent", { ref: "refs/heads/dev", size: 1 }, "2")),
    activityOf(ev("PullRequestEvent", { action: "opened", pull_request: { number: 1 } }, "3")),
  ].filter((x) => x !== null);
  assert.deepEqual(statsOf(items), { pushes: 2, commits: 4, prs: 1, issues: 0, comments: 0, repos: 1 });
});
