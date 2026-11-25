import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { memSql } from "./sql";

const { TODO_COLL, TODO_LEGACY_ID, TODO_PLUGIN, TODO_V2, checkTodoBody, parseManifest, resolvePluginId, pluginChannel, pluginSpaceId } = await import("@hx-aioa/protocol");
const { AllowStore } = await import("../src/plugins/allow-store");
const { PluginKernel } = await import("../src/plugins/kernel");
const { PluginStore } = await import("../src/plugins/store");
const { ChatStore } = await import("../src/chat-store");
const { PDataStore } = await import("../src/plugins/pdata");
const { TodoStore } = await import("../src/plugins/todos");
const { migrateTodo } = await import("../src/plugins/todo-migrate");
const { legacySeed } = await import("../src/plugins/seed");

const OWNER = "u_owner";
const MEMBER = "u_m";
const CH = "plugin-todo";
const tx = <T>(fn: () => T): T => fn();
const manifest = { id: TODO_LEGACY_ID, name: "点子待办", summary: "", version: "1.4.0", readme: "README.md", prompt: "prompt.md", group: { title: "点子待办" }, agent: { name: "整理员", interval: 1800 } };
const install = { id: TODO_LEGACY_ID, version: "1.4.0", name: "点子待办", channel: CH, keyId: "k1", installed: 1, space: CH };

// 升级前 (#99 之后, #101 之前) 的库: 旧 todo 表, 白名单, 启用, 安装记录, 群里 Agent 的 plugin 都是旧 id
function oldDb(opts: { allow?: boolean } = {}) {
  const sql = memSql();
  const allow = new AllowStore(sql);
  const plugins = new PluginStore(sql);
  const chats = new ChatStore(sql);
  plugins.save(install, "点子待办", "提示词");
  if (opts.allow !== false) {
    allow.putAllow({ meta: { id: TODO_LEGACY_ID, version: "1.4.0", name: "点子待办", by: "owner", at: 1 }, manifest, prompt: "提示词" });
    allow.setEnabled(OWNER, TODO_LEGACY_ID, true);
    allow.setEnabled(MEMBER, TODO_LEGACY_ID, true);
    allow.markSeeded();
  }
  chats.replaceChat({ channel: CH, updated: 1, agents: [{ keyId: "k1", sourceId: "s1", name: "整理员", reads: [CH], created: 1, plugin: TODO_LEGACY_ID }] });
  sql.exec("CREATE TABLE todo (grp TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (grp, id))");
  const put = (grp: string, t: Record<string, unknown>) => sql.exec("INSERT INTO todo (grp, id, body) VALUES (?, ?, ?)", grp, t.id, JSON.stringify(t));
  put(CH, { id: "t-1", title: "调研", state: "open", prio: 3, src: 7, note: "先看", created: 100, updated: 200 });
  put(CH, { id: "t-2", title: "做完的", state: "done", prio: 2, created: 101, updated: 300 });
  put("other_grp", { id: "t-1", title: "别的群", state: "doing", prio: 1, created: 102, updated: 400 });
  return { sql, chats };
}

test("迁移: 旧表搬进 pdata, 旧 id 全部改成新 id, 群与工作台不改名, 旧表删掉", () => {
  const { sql, chats } = oldDb();
  const todos = new TodoStore(sql, () => OWNER, tx);
  const items = todos.list(CH).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(items, [
    { id: "t-1", title: "调研", state: "open", prio: 3, created: 100, updated: 200, note: "先看", src: 7 },
    { id: "t-2", title: "做完的", state: "done", prio: 2, created: 101, updated: 300 },
  ]);
  assert.equal(todos.list("other_grp")[0]?.title, "别的群");
  assert.equal(todos.list("other").length, 0, "群名前缀不能误匹配");
  assert.equal(sql.exec("SELECT name FROM sqlite_master WHERE name = 'todo'").toArray().length, 0);
  const pd = new PDataStore(sql);
  assert.equal(pd.list(OWNER, TODO_PLUGIN, TODO_COLL).items.length, 3);
  const k = new PluginKernel(new AllowStore(sql));
  assert.ok(k.isEnabled(OWNER, TODO_PLUGIN) && k.isEnabled(MEMBER, TODO_PLUGIN));
  assert.ok(!k.get(TODO_LEGACY_ID));
  const m = k.get(TODO_PLUGIN)!.manifest;
  assert.equal(m.version, "1.4.0", "版本号不变, 管理员放行 2.0.0 后才换");
  assert.deepEqual(m.contributes?.collections, TODO_V2.contributes?.collections);
  assert.ok(m.permissions?.includes("data:own"));
  const rec = new PluginStore(sql).get(TODO_PLUGIN);
  assert.equal(rec?.channel, CH);
  assert.equal(rec?.space, CH);
  assert.equal(new PluginStore(sql).get(TODO_LEGACY_ID), null);
  assert.equal(chats.chat(CH)?.agents?.[0]?.plugin, TODO_PLUGIN);
});

test("迁移幂等: 再跑一次不写; 标记丢了旧表又在也不重复写", () => {
  const { sql } = oldDb();
  const pd = new PDataStore(sql);
  assert.equal(migrateTodo(sql, pd, () => OWNER, tx), 3);
  const before = pd.list(OWNER, TODO_PLUGIN, TODO_COLL);
  assert.equal(migrateTodo(sql, pd, () => OWNER, tx), 0);
  sql.exec("DELETE FROM plugin_flag WHERE k = 'todo-v2'");
  sql.exec("CREATE TABLE todo (grp TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (grp, id))");
  sql.exec("INSERT INTO todo (grp, id, body) VALUES (?, ?, ?)", CH, "t-1", JSON.stringify({ id: "t-1", title: "旧的", state: "open", prio: 2, created: 1, updated: 1 }));
  assert.equal(migrateTodo(sql, pd, () => OWNER, tx), 0);
  assert.deepEqual(pd.list(OWNER, TODO_PLUGIN, TODO_COLL), before);
});

test("#99 之前的库 (白名单为空): 升级种子用新 id, 带上 v2 数据声明", () => {
  const { sql } = oldDb({ allow: false });
  new TodoStore(sql, () => OWNER, tx);
  const plugins = new PluginStore(sql);
  const k = new PluginKernel(new AllowStore(sql), () => legacySeed(plugins, OWNER));
  assert.ok(k.isEnabled(OWNER, TODO_PLUGIN));
  assert.ok(k.get(TODO_PLUGIN)?.manifest.permissions?.includes("data:own"));
});

test("转发层: 按 id 合并, 内容没变不写, 删除写墓碑, 删后可重建", () => {
  const todos = new TodoStore(memSql(), () => OWNER, tx);
  const a = todos.upsert(CH, [{ id: "t-9", title: "新的", prio: 1 }], 10);
  assert.ok(typeof a !== "string" && a.rev > 0 && a.todos[0]?.state === "open");
  const same = todos.upsert(CH, [{ id: "t-9", title: "新的" }], 11);
  assert.ok(typeof same !== "string" && same.rev === 0 && same.todos.length === 0);
  const b = todos.upsert(CH, [{ id: "t-9", state: "done", note: "好了" }], 12);
  assert.ok(typeof b !== "string" && b.todos[0]?.created === 10 && b.todos[0]?.updated === 12 && b.todos[0]?.note === "好了");
  assert.equal(todos.upsert(CH, [{ id: "t-10" }]), "新增待办需要 title");
  assert.match(String(todos.upsert(CH, [{ id: "x".repeat(60), title: "长" }])), /64/);
  assert.ok(todos.remove(CH, "t-9") > 0);
  assert.equal(todos.remove(CH, "t-9"), 0);
  assert.equal(todos.list(CH).length, 0);
  const again = todos.upsert(CH, [{ id: "t-9", title: "重建" }], 13);
  assert.ok(typeof again !== "string" && again.todos[0]?.title === "重建" && again.todos[0]?.state === "open");
});

test("待办行校验与 id 别名", () => {
  const ok = { channel: CH, title: "x", state: "open", prio: 2, created: 1 };
  assert.equal(checkTodoBody(`${CH}:t-1`, ok), null);
  assert.match(String(checkTodoBody("other:t-1", ok)), /<群>/);
  assert.match(String(checkTodoBody(`${CH}:t-1`, { ...ok, state: "x" })), /state/);
  assert.match(String(checkTodoBody(`${CH}:t-1`, { ...ok, prio: 9 })), /prio/);
  assert.equal(resolvePluginId(TODO_LEGACY_ID), TODO_PLUGIN);
  assert.equal(resolvePluginId("a.b"), "a.b");
  assert.equal(pluginChannel(TODO_PLUGIN), CH);
  assert.equal(pluginSpaceId(TODO_PLUGIN), CH);
  assert.equal(pluginChannel("a.b"), "plugin-a.b");
});

test("市场里的清单与服务端的待办数据声明一致", () => {
  const raw = JSON.parse(readFileSync(new URL(`../../plugins/${TODO_PLUGIN}/plugin.json`, import.meta.url), "utf8"));
  const m = parseManifest(raw);
  assert.ok(typeof m !== "string", String(m));
  for (const k of ["api", "engines", "permissions", "contributes", "budget"] as const) assert.deepEqual(m[k], TODO_V2[k], k);
});
