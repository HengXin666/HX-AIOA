import assert from "node:assert/strict";
import { test } from "node:test";

const { parseManifest, satisfies, isRange, cronPerDay, dailyRequests, checkPlugins, isPluginId } = await import("@hx-aioa/protocol");

const base = (over: Record<string, unknown> = {}) => ({
  id: "alice.notes",
  name: "笔记",
  summary: "s",
  version: "1.0.0",
  readme: "README.md",
  prompt: "prompt.md",
  group: { title: "笔记" },
  agent: { name: "助手" },
  api: "2",
  engines: { aioa: "^2" },
  ...over,
});

test("semver 范围", () => {
  assert.ok(satisfies("2.3.1", "^2"));
  assert.ok(!satisfies("3.0.0", "^2"));
  assert.ok(satisfies("0.2.5", "^0.2"));
  assert.ok(!satisfies("0.3.0", "^0.2.1"));
  assert.ok(satisfies("1.2.9", "~1.2"));
  assert.ok(satisfies("1.5.0", ">=1.2 <2"));
  assert.ok(satisfies("9.9.9", "*"));
  assert.ok(!isRange("^x"));
  assert.ok(!isRange(""));
  assert.ok(!satisfies("1.0.0-beta", ">=1.0.0"));
  assert.ok(satisfies("1.0.0-beta.2", ">=1.0.0-beta.1"));
});

test("插件 id: 旧格式与命名空间格式都认", () => {
  assert.ok(isPluginId("todo"));
  assert.ok(isPluginId("hengxin.todo"));
  assert.ok(!isPluginId("HengXin.todo"));
  assert.ok(!isPluginId("a.b.c"));
});

test("旧清单 (api 1) 照常能用, 但不能用 v2 字段", () => {
  const { api: _a, engines: _e, ...old } = base({ id: "todo" });
  assert.equal(typeof parseManifest(old), "object");
  assert.match(String(parseManifest({ ...old, permissions: [] })), /api/);
});

test("v2 清单校验", () => {
  assert.equal(typeof parseManifest(base()), "object");
  assert.match(String(parseManifest(base({ engines: undefined }))), /engines/);
  assert.match(String(parseManifest(base({ agent: { name: "a", interval: 20 } }))), /60/);
  assert.match(String(parseManifest(base({ contributes: { commands: [{ id: "other.add" }] } }))), /alice\.notes\./);
  assert.match(String(parseManifest(base({ contributes: { nope: [] } }))), /没有扩展点/);
  assert.match(String(parseManifest(base({ contributes: { "core.theme.base": [{ id: "alice.notes.dark" }] } }))), /core\.replace/);
  assert.equal(typeof parseManifest(base({ permissions: ["core.replace"], contributes: { "core.theme.base": [{ id: "alice.notes.dark" }] } })), "object");
  assert.match(String(parseManifest(base({ emits: ["bob.x"] }))), /emits/);
  assert.match(String(parseManifest(base({ permissions: ["root"] }))), /权限/);
  assert.match(String(parseManifest(base({ budget: { agentPoll: 30 } }))), /agentPoll/);
  assert.match(String(parseManifest(base({ contributes: { collections: [{ id: "Items" }] } }))), /集合名/);
});

test("请求估算", () => {
  assert.equal(cronPerDay("0 * * * *"), 24);
  assert.equal(cronPerDay("*/15 9-17 * * *"), 36);
  const m = parseManifest(base({ budget: { cron: "0 * * * *", agentPoll: 60, requestsPerDay: 10 } }));
  assert.equal(typeof m === "object" && dailyRequests(m), 24 + 1440 * 3 + 10);
  const sneaky = parseManifest(base({ agent: { name: "a", interval: 120 }, budget: { agentPoll: 0 } }));
  assert.equal(typeof sneaky === "object" && dailyRequests(sneaky), 720 * 3, "agentPoll: 0 盖不掉 interval");
  assert.match(String(parseManifest(base({ budget: { cron: "0 23-1 * * *" } }))), /cron/);
  assert.match(String(parseManifest(base({ budget: { cron: "99 * * * *" } }))), /cron/);
});

const P = (id: string, over: Record<string, unknown> = {}) => {
  const m = parseManifest(base({ id, ...over }));
  if (typeof m === "string") throw new Error(m);
  return m;
};
const kinds = (r: { conflicts: { kind: string }[] }) => r.conflicts.map((c) => c.kind).sort();

test("冲突: 宿主版本, 依赖缺失, 声明冲突", () => {
  assert.deepEqual(kinds(checkPlugins([P("a.x", { engines: { aioa: "^3" } })], { engine: "2.0.0" })), ["engine"]);
  assert.deepEqual(kinds(checkPlugins([P("a.x", { requires: { "service:cal": "^1" } })], { engine: "2.0.0" })), ["requires"]);
  const ok = checkPlugins([P("a.x", { requires: { "service:cal": "^1" } }), P("b.y", { provides: { "service:cal": "1.2.0" } })], { engine: "2.0.0" });
  assert.deepEqual(ok.conflicts, []);
  assert.deepEqual(kinds(checkPlugins([P("a.x", { conflicts: { "b.y": "*" } }), P("b.y")], { engine: "2.0.0" })), ["conflicts"]);
});

test("冲突: single 需要默认, 撞名, pipeline 成环与无序同写", () => {
  const th = (id: string) => P(id, { permissions: ["core.replace"], contributes: { "core.theme.base": [{ id: `${id}.t` }] } });
  assert.deepEqual(kinds(checkPlugins([th("a.x"), th("b.y")], { engine: "2.0.0" })), ["single"]);
  assert.deepEqual(checkPlugins([th("a.x"), th("b.y")], { engine: "2.0.0", defaults: { "core.theme.base": "b.y" } }).conflicts, []);
  const svc = (id: string) => P(id, { provides: { "service:cal": "1.0.0" } });
  assert.deepEqual(kinds(checkPlugins([svc("a.x"), svc("b.y")], { engine: "2.0.0" })), ["single"]);
  const loop = checkPlugins(
    [P("a.x", { contributes: { "push.route": [{ id: "a.x.r", before: ["b.y.r"] }] } }), P("b.y", { contributes: { "push.route": [{ id: "b.y.r", before: ["a.x.r"] }] } })],
    { engine: "2.0.0" },
  );
  assert.ok(kinds(loop).includes("order"));
  const write = checkPlugins(
    [P("a.x", { contributes: { "push.route": [{ id: "a.x.r", writes: ["level"] }] } }), P("b.y", { contributes: { "push.route": [{ id: "b.y.r", writes: ["level"] }] } })],
    { engine: "2.0.0" },
  );
  assert.deepEqual(kinds(write), ["order"]);
  const fixed = checkPlugins(
    [P("a.x", { contributes: { "push.route": [{ id: "a.x.r", writes: ["level"] }] } }), P("b.y", { contributes: { "push.route": [{ id: "b.y.r", writes: ["level"], after: ["a.x.r"] }] } })],
    { engine: "2.0.0" },
  );
  assert.deepEqual(fixed.conflicts, []);
});

test("冲突: 每日请求预算", () => {
  const r = checkPlugins([P("a.x", { budget: { agentPoll: 60 } }), P("b.y", { budget: { agentPoll: 60 } })], { engine: "2.0.0", budget: 2000 });
  assert.equal(r.total, 2880 * 3);
  assert.deepEqual(kinds(r), ["budget"]);
});
