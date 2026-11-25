import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { memSql } from "./sql";

const { GH_LEGACY_ID, GH_PLUGIN_ID, GH_SERVICE, TODO_PLUGIN, TODO_V2, parseManifest, resolvePluginId, checkTodoBody, todoOf } = await import("@hx-aioa/protocol");
const { AllowStore } = await import("../src/plugins/allow-store");
const { PluginKernel } = await import("../src/plugins/kernel");
const { seedBuiltins } = await import("../src/plugins/builtins");
const { normTodo } = await import("../src/plugins/todos");

const OWNER = "u-owner";
const raw = JSON.parse(readFileSync(new URL("../../plugins/hengxin666.gh/plugin.json", import.meta.url), "utf8"));
const todoRaw = JSON.parse(readFileSync(new URL("../../plugins/hengxin666.todo/plugin.json", import.meta.url), "utf8"));

function legacy(installed: string[]) {
  const set = new Set(installed);
  return { set, has: (id: string) => set.has(id), remove: (id: string) => void set.delete(id) };
}

test("GitHub 授权清单: api 2, 无 Agent, 提供 issue 服务; 旧 id gh 是别名; 待办清单可选依赖它", () => {
  const m = parseManifest(raw);
  assert.equal(typeof m, "object");
  if (typeof m === "string") return;
  assert.equal(m.id, GH_PLUGIN_ID);
  assert.equal(m.agent, undefined);
  assert.ok(Object.hasOwn(m.provides ?? {}, GH_SERVICE));
  assert.equal(resolvePluginId(GH_LEGACY_ID), GH_PLUGIN_ID);
  assert.ok(Object.hasOwn(todoRaw.optional ?? {}, GH_SERVICE));
  assert.ok(Object.hasOwn(TODO_V2.optional ?? {}, GH_SERVICE));
  // 旧格式 base 插件按无 Agent 处理, 不再补空名 Agent
  const base = parseManifest({ id: "gh", name: "x", summary: "x", version: "1.0.0", readme: "README.md", prompt: "prompt.md", base: true });
  assert.ok(typeof base === "object" && base.agent === undefined);
});

test("升级迁移: 装过 gh 才放行并为主人启用, 删掉旧安装记录, 只跑一次", () => {
  const sql = memSql();
  const allow = new AllowStore(sql);
  const old = legacy([GH_LEGACY_ID, "todo"]);
  const k = new PluginKernel(allow, undefined, () => seedBuiltins(allow, OWNER, 1, old));
  assert.ok(k.isEnabled(OWNER, GH_PLUGIN_ID));
  assert.ok(!old.set.has(GH_LEGACY_ID), "旧 base 记录删掉");
  assert.ok(old.set.has("todo"), "别的安装记录不动");
  k.setEnabled(OWNER, GH_PLUGIN_ID, false);
  const again = legacy([GH_LEGACY_ID]);
  const k2 = new PluginKernel(new AllowStore(sql), undefined, () => seedBuiltins(new AllowStore(sql), OWNER, 1, again));
  assert.ok(!k2.isEnabled(OWNER, GH_PLUGIN_ID), "停用后重启不被改回");

  const fresh = new AllowStore(memSql());
  const k3 = new PluginKernel(fresh, undefined, () => seedBuiltins(fresh, OWNER, 1, legacy([])));
  assert.equal(k3.get(GH_PLUGIN_ID), undefined, "没装过就不放行, 等管理员");
});

test("待办行: 关联字段校验, doneAt 与 gh 由服务端维护", () => {
  const base = { channel: "plugin-todo", title: "t", state: "open" as const, prio: 2 as const, created: 1 };
  assert.equal(checkTodoBody("plugin-todo:a", { ...base, repo: "o/r", issue: 3, parent: "b" }), null);
  assert.match(String(checkTodoBody("plugin-todo:a", { ...base, repo: "bad" })), /repo/);
  assert.match(String(checkTodoBody("plugin-todo:a", { ...base, parent: "a" })), /parent/);
  assert.match(String(checkTodoBody("plugin-todo:a", { ...base, issue: 0 })), /issue/);

  const gh = { state: "open" as const, comments: 1, synced: 5 };
  const prev = { ...base, repo: "o/r", issue: 3, gh };
  // 客户端整行写回时丢了 gh, 关联不变就沿用; 写了假的 gh 也不算
  assert.deepEqual(normTodo(prev, { ...base, repo: "o/r", issue: 3 }).gh, gh);
  assert.deepEqual(normTodo(prev, { ...base, repo: "o/r", issue: 3, gh: { state: "closed", comments: 9, synced: 1 } }).gh, gh);
  assert.equal(normTodo(prev, { ...base, repo: "o/r", issue: 4 }).gh, undefined, "换了 issue 丢掉旧同步状态");
  const done = normTodo(prev, { ...prev, state: "done" }, 100);
  assert.equal(done.doneAt, 100);
  assert.equal(normTodo(done, { ...done, doneAt: 7 }, 200).doneAt, 100, "一直是 done 就保留原完成时间");
  assert.equal(normTodo(done, { ...done, state: "open" }, 300).doneAt, undefined);
  // 字段顺序不变: 内容没变就不会多写一次库
  assert.equal(JSON.stringify(normTodo(prev, { ...prev })), JSON.stringify(prev));

  const item = todoOf({ id: "plugin-todo:a", ver: 1, rev: 1, updated: 9, body: prev }, "plugin-todo");
  assert.deepEqual(item, { title: "t", state: "open", prio: 2, created: 1, repo: "o/r", issue: 3, gh, id: "a", updated: 9 });
  assert.equal(TODO_PLUGIN, "hengxin666.todo");
});

test("升级迁移: 没装待办插件但库里有待办, 放行并为主人启用; 没有待办不动", () => {
  const a = new AllowStore(memSql());
  const k = new PluginKernel(a, undefined, () => seedBuiltins(a, OWNER, 1, { ...legacy([]), hasTodos: () => true }));
  assert.ok(k.isEnabled(OWNER, TODO_PLUGIN));
  const b = new AllowStore(memSql());
  const k2 = new PluginKernel(b, undefined, () => seedBuiltins(b, OWNER, 1, { ...legacy([]), hasTodos: () => false }));
  assert.equal(k2.get(TODO_PLUGIN), undefined);
});
