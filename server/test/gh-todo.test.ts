import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGhRules, parseTodoInput, type TodoItem } from "@hx-aioa/protocol";
import { repoAllowed } from "../src/gh/service";
import { nextState } from "../src/gh/todo-sync";
import { todosMarkdown } from "../src/plugins/todo-md";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 25, 12);

test("gh 仓库规则: deny > 手动 > 公开/私有/近 N 天", () => {
  const pub = { repo: "a/pub", private: false, pushed: NOW - 400 * DAY };
  const pri = { repo: "a/pri", private: true, pushed: NOW - 10 * DAY };
  assert.equal(repoAllowed(pub, {}, NOW), false);
  assert.equal(repoAllowed(pub, { public: true }, NOW), true);
  assert.equal(repoAllowed(pri, { pushedDays: 365 }, NOW), true);
  assert.equal(repoAllowed(pub, { pushedDays: 365 }, NOW), false);
  assert.equal(repoAllowed(pri, { private: true, deny: ["a/pri"] }, NOW), false);
  assert.equal(repoAllowed(pub, { repos: ["a/pub"] }, NOW), true);
  assert.equal(typeof parseGhRules({ pushedDays: 0 }), "string");
  assert.deepEqual(parseGhRules({ pushedDays: 30, public: true, repos: ["a/b", "a/b"] }), { pushedDays: 30, public: true, repos: ["a/b"] });
});

test("issue -> 待办状态: 关闭完成, 有评论进行中, 重开回退, 挂起不动", () => {
  const open = (comments: number) => ({ state: "open" as const, comments, synced: NOW });
  const closed = { state: "closed" as const, comments: 0, synced: NOW };
  assert.equal(nextState("open", undefined, closed), "done");
  assert.equal(nextState("done", undefined, closed), undefined);
  assert.equal(nextState("open", undefined, open(2)), "doing");
  assert.equal(nextState("hold", undefined, open(2)), undefined);
  assert.equal(nextState("done", closed, open(0)), "open");
  assert.equal(nextState("done", undefined, open(0)), undefined);
});

test("待办输入: repo / issue / parent 校验", () => {
  assert.deepEqual(parseTodoInput({ id: "t-1", repo: "HengXin666/HX-AIOA", issue: 94, parent: "t-0", state: "hold" }), { id: "t-1", repo: "HengXin666/HX-AIOA", issue: 94, parent: "t-0", state: "hold" });
  assert.equal(typeof parseTodoInput({ id: "t-1", repo: "bad" }), "string");
  assert.equal(typeof parseTodoInput({ id: "t-1", parent: "t-1" }), "string");
});

test("待办 Markdown: 按天按仓库分组, 子待办缩进, 默认藏已完成", () => {
  const t = (id: string, o: Partial<TodoItem>): TodoItem => ({ id, title: id, state: "open", prio: 2, created: NOW, updated: NOW, ...o });
  const todos = [t("p", { repo: "a/b", issue: 75 }), t("c", { repo: "a/b", issue: 94, gh: { state: "open", comments: 1, parent: 75, synced: NOW } }), t("d", { state: "done" }), t("x", { created: NOW - 2 * DAY })];
  const md = todosMarkdown("点子", todos);
  assert.match(md, /## 2026-11-25\n### a\/b\n- \[ \] `p`/);
  assert.match(md, /\n  - \[ \] `c` \[待进行\] P2 c \(a\/b#94 1 评论\)/);
  assert.doesNotMatch(md, /`d`/);
  assert.match(md, /## 2026-11-23\n### 未关联仓库/);
  assert.match(todosMarkdown("点子", todos, { all: true }), /- \[x\] `d` \[已完成\]/);
});
