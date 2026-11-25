import assert from "node:assert/strict";
import { test } from "node:test";
import { memSql } from "./sql";

const { parseManifest } = await import("@hx-aioa/protocol");
const { AllowStore } = await import("../src/plugins/allow-store");
const { PluginKernel } = await import("../src/plugins/kernel");

const OWNER = "u-owner";
const BOB = "u-bob";

function row(id: string, over: Record<string, unknown> = {}, defaults?: string[]) {
  const m = parseManifest({ id, name: id, summary: "s", version: "1.0.0", readme: "README.md", prompt: "prompt.md", group: { title: id }, agent: { name: "a" }, api: "2", engines: { aioa: "^2" }, ...over });
  if (typeof m === "string") throw new Error(m);
  return { meta: { id, version: m.version, name: id, by: OWNER, at: 1, ...(defaults ? { defaults } : {}) }, manifest: m, prompt: "p" };
}

function fresh() {
  const sql = memSql();
  return { sql, k: new PluginKernel(new AllowStore(sql)) };
}

test("放行与账号启用: 没放行不能开, 启用只影响本账号, 唤醒后从库里恢复", () => {
  const { sql, k } = fresh();
  assert.equal(k.setEnabled(OWNER, "a.x", true), false);
  k.put(row("a.x"));
  assert.equal(k.setEnabled(OWNER, "a.x", true), true);
  assert.ok(k.isEnabled(OWNER, "a.x"));
  assert.ok(!k.isEnabled(BOB, "a.x"));
  const again = new PluginKernel(new AllowStore(sql));
  assert.ok(again.isEnabled(OWNER, "a.x"));
  assert.deepEqual(again.enabledOf(BOB), []);
});

test("撤销放行: 所有账号的启用, 注册, 订阅一起撤掉", () => {
  const { sql, k } = fresh();
  k.put(row("a.x", { contributes: { commands: [{ id: "a.x.c" }] }, listens: ["b.y.ev"] }));
  k.put(row("b.y", { emits: ["b.y.ev"] }));
  for (const u of [OWNER, BOB]) {
    k.setEnabled(u, "a.x", true);
    k.setEnabled(u, "b.y", true);
  }
  let got = 0;
  assert.ok(k.on("a.x", "b.y.ev", () => (got += 1)));
  assert.equal(k.emit(OWNER, "b.y", "b.y.ev", {}), 1);
  assert.deepEqual(k.revoke("a.x").sort(), [BOB, OWNER].sort());
  assert.equal(k.contributions(OWNER, "commands").length, 0);
  assert.equal(k.emit(OWNER, "b.y", "b.y.ev", {}), 0);
  assert.equal(got, 1);
  assert.deepEqual(new PluginKernel(new AllowStore(sql)).enabledOf(OWNER), ["b.y"]);
});

test("事件总线: 只发给该账号启用了的监听者, 没声明 emits / listens 的不行", () => {
  const { k } = fresh();
  k.put(row("a.x", { listens: ["b.y.ev"] }));
  k.put(row("b.y", { emits: ["b.y.ev"] }));
  k.setEnabled(OWNER, "a.x", true);
  k.setEnabled(OWNER, "b.y", true);
  k.setEnabled(BOB, "b.y", true);
  const seen: string[] = [];
  k.on("a.x", "b.y.ev", (uid) => seen.push(uid));
  assert.equal(k.on("b.y", "b.y.ev", () => undefined), null);
  k.emit(OWNER, "b.y", "b.y.ev", 1);
  k.emit(BOB, "b.y", "b.y.ev", 1);
  assert.deepEqual(seen, [OWNER]);
  assert.equal(k.emit(OWNER, "a.x", "b.y.ev", 1), -1);
});

test("single 扩展点: 账号选择 > 管理员默认 > 唯一启用者", () => {
  const { k } = fresh();
  const th = (id: string, d?: string[]) => row(id, { permissions: ["core.replace"], contributes: { "core.theme.base": [{ id: `${id}.t` }] } }, d);
  k.put(th("a.x"));
  k.put(th("b.y", ["core.theme.base"]));
  k.setEnabled(OWNER, "a.x", true);
  assert.equal(k.contributions(OWNER, "core.theme.base")[0]?.plugin, "a.x");
  k.setEnabled(OWNER, "b.y", true);
  assert.equal(k.contributions(OWNER, "core.theme.base")[0]?.plugin, "b.y");
  assert.equal(k.choose(OWNER, "core.theme.base", "a.x"), null);
  assert.equal(k.contributions(OWNER, "core.theme.base")[0]?.plugin, "a.x");
  assert.match(String(k.choose(BOB, "core.theme.base", "a.x")), /没启用/);
  assert.match(String(k.choose(OWNER, "commands", "a.x")), /不是单选/);
  k.setEnabled(OWNER, "a.x", false);
  assert.equal(k.contributions(OWNER, "core.theme.base")[0]?.plugin, "b.y");
});

test("把默认给了新插件, 旧插件的默认自动去掉", () => {
  const { k } = fresh();
  const th = (id: string, d?: string[]) => row(id, { permissions: ["core.replace"], contributes: { "core.theme.base": [{ id: `${id}.t` }] } }, d);
  k.put(th("a.x", ["core.theme.base"]));
  k.put(th("b.y", ["core.theme.base"]));
  assert.equal(k.get("a.x")?.meta.defaults?.length ?? 0, 0);
  assert.deepEqual(k.check().conflicts, []);
});

test("pipeline 按 before / after 排序, 服务按账号裁决", () => {
  const { k } = fresh();
  k.put(row("a.x", { contributes: { "push.route": [{ id: "a.x.r", after: ["b.y.r"] }] }, provides: { "service:cal": "1.0.0" } }));
  k.put(row("b.y", { contributes: { "push.route": [{ id: "b.y.r" }] } }));
  k.setEnabled(OWNER, "a.x", true);
  k.setEnabled(OWNER, "b.y", true);
  assert.deepEqual(k.contributions(OWNER, "push.route").map((e) => e.c.id), ["b.y.r", "a.x.r"]);
  assert.equal(k.service(OWNER, "service:cal"), "a.x");
  assert.equal(k.service(BOB, "service:cal"), undefined);
});

test("升级迁移: 白名单为空时把已装插件放进去并为主人启用, 只跑一次", () => {
  const sql = memSql();
  let calls = 0;
  const seed = () => {
    calls += 1;
    return { rows: [row("todo", { api: undefined, engines: undefined })], uid: OWNER };
  };
  const k = new PluginKernel(new AllowStore(sql), seed);
  assert.ok(k.isEnabled(OWNER, "todo"));
  new PluginKernel(new AllowStore(sql), seed).list();
  assert.equal(calls, 1);
  k.revoke("todo");
  assert.equal(new PluginKernel(new AllowStore(sql), seed).list().length, 0, "白名单清空后不再重新播种");
  assert.equal(calls, 1);
});

test("换版本不丢进程内监听, 撤销才清", () => {
  const { k } = fresh();
  k.put(row("a.x", { listens: ["b.y.ev"] }));
  k.put(row("b.y", { emits: ["b.y.ev"] }));
  k.setEnabled(OWNER, "a.x", true);
  k.setEnabled(OWNER, "b.y", true);
  k.on("a.x", "b.y.ev", () => undefined);
  k.put(row("a.x", { listens: ["b.y.ev"], version: "1.0.1" }));
  assert.equal(k.emit(OWNER, "b.y", "b.y.ev", 1), 1);
  k.revoke("a.x");
  assert.equal(k.emit(OWNER, "b.y", "b.y.ev", 1), 0);
});

test("撤销前检查: 去掉默认提供者或被依赖的服务会冲突", () => {
  const { k } = fresh();
  const th = (id: string, d?: string[]) => row(id, { permissions: ["core.replace"], contributes: { "core.theme.base": [{ id: `${id}.t` }] } }, d);
  k.put(th("a.x", ["core.theme.base"]));
  k.put(th("b.y"));
  k.put(th("c.z"));
  assert.ok(k.check(undefined, "a.x").conflicts.some((c) => c.kind === "single"));
  k.put(row("s.v", { provides: { "service:x": "1.0.0" } }));
  k.put(row("q.w", { requires: { "service:x": "^1" } }));
  assert.ok(k.check(undefined, "s.v").conflicts.some((c) => c.kind === "requires"));
});

test("pipeline 在全集上排序: 中间的没启用也保住先后", () => {
  const { k } = fresh();
  k.put(row("a.x", { contributes: { "push.route": [{ id: "a.x.r", before: ["b.y.r"] }] } }));
  k.put(row("b.y", { contributes: { "push.route": [{ id: "b.y.r", before: ["c.z.r"] }] } }));
  k.put(row("c.z", { contributes: { "push.route": [{ id: "c.z.r" }] } }));
  k.setEnabled(OWNER, "c.z", true);
  k.setEnabled(OWNER, "a.x", true);
  assert.deepEqual(k.contributions(OWNER, "push.route").map((e) => e.c.id), ["a.x.r", "c.z.r"]);
});
