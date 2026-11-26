import assert from "node:assert/strict";
import { test } from "node:test";
import { memSql } from "./sql";

const { L2A_PLUGINS, PERM_REPLACE, isRisky, parseManifest } = await import("@hx-aioa/protocol");
const { AllowStore } = await import("../src/plugins/allow-store");
const { PluginKernel } = await import("../src/plugins/kernel");
const { L2A } = await import("../src/plugins/l2a");

const ADMIN = "u-admin";
const BOB = "u-bob";
const base = { name: "n", summary: "s", version: "1.0.0", readme: "README.md", prompt: "prompt.md", group: { title: "t" }, api: "2", engines: { aioa: "^2" } };

function row(id: string, over: Record<string, unknown> = {}, dev = false) {
  const m = parseManifest({ ...base, id, ...over });
  if (typeof m === "string") throw new Error(m);
  return { meta: { id, version: "1.0.0", name: id, by: ADMIN, at: 1, ...(dev ? { dev: true as const } : {}) }, manifest: m, prompt: "" };
}

test("清单: net 只给带服务端代码的插件, 读别人数据算高危", () => {
  assert.match(String(parseManifest({ ...base, id: "a.x", permissions: ["net:example.com"] })), /server/);
  assert.equal(typeof parseManifest({ ...base, id: "a.x", server: true, permissions: ["net:example.com"] }), "object");
  assert.match(String(parseManifest({ ...base, id: "a.x", server: "yes" })), /server/);
  assert.match(String(parseManifest({ ...base, id: "a.x", api: undefined, engines: undefined, server: true, agent: { name: "a" } })), /api/);
  assert.ok(isRisky("data:read:b.y.items"));
  assert.ok(!isRisky("data:own"));
});

test("L2a 登记表与协议里的 L2A_PLUGINS 一致", () => {
  assert.deepEqual(Object.keys(L2A).sort(), [...L2A_PLUGINS].sort());
});

test("开发插件: 只有开发者看得到, 用得了; 不参与别人的冲突检测", () => {
  const sql = memSql();
  const k = new PluginKernel(new AllowStore(sql));
  const theme = { permissions: [PERM_REPLACE], contributes: { "core.theme.base": [{ id: "d.x.t" }] } };
  k.put(row("d.x", theme, true));
  k.setDevMode(ADMIN, true);
  assert.ok(k.setEnabled(ADMIN, "d.x", true));
  assert.ok(!k.setEnabled(BOB, "d.x", true), "别人不能启用");
  assert.deepEqual(k.visible(BOB).map((a) => a.id), []);
  assert.deepEqual(k.visible(ADMIN).map((a) => a.id), ["d.x"]);
  // 正式放行一个同样替换主题的插件, 不因为开发插件报单选冲突
  assert.deepEqual(k.check(row("m.y", { permissions: [PERM_REPLACE], contributes: { "core.theme.base": [{ id: "m.y.t" }] } })).conflicts, []);
  // 检查开发插件自己时对白名单照常算冲突
  k.put(row("m.y", { permissions: [PERM_REPLACE], contributes: { "core.theme.base": [{ id: "m.y.t" }] } }));
  assert.ok(k.check(row("d.x", theme, true)).conflicts.some((c) => c.kind === "single"));
  assert.ok(!k.check().conflicts.length, "白名单本身不受开发插件影响");
});

test("开发模式开关存库, 重启后还在", () => {
  const sql = memSql();
  const k = new PluginKernel(new AllowStore(sql));
  assert.ok(!k.devMode(ADMIN));
  k.setDevMode(ADMIN, true);
  assert.ok(new PluginKernel(new AllowStore(sql)).devMode(ADMIN));
  k.setDevMode(ADMIN, false);
  assert.ok(!new PluginKernel(new AllowStore(sql)).devMode(ADMIN));
});

test("开发插件的 pipeline 先后不影响别人", () => {
  const k = new PluginKernel(new AllowStore(memSql()));
  const pipe = (id: string, c: Record<string, unknown>) => row(id, { contributes: { "push.route": [{ id: `${id}.r`, ...c }] } });
  k.put(pipe("m.a", {}));
  k.put(pipe("m.b", {}));
  k.put({ ...pipe("d.x", { after: ["m.b.r"], before: ["m.a.r"] }), meta: { ...pipe("d.x", {}).meta, dev: true } });
  k.setDevMode(ADMIN, true);
  for (const u of [ADMIN, BOB]) for (const p of ["m.a", "m.b"]) k.setEnabled(u, p, true);
  k.setEnabled(ADMIN, "d.x", true);
  assert.deepEqual(k.contributions(BOB, "push.route").map((e) => e.plugin), ["m.a", "m.b"], "别人的顺序不受开发插件的边影响");
  assert.deepEqual(k.contributions(ADMIN, "push.route").map((e) => e.plugin), ["m.b", "d.x", "m.a"]);
});

test("开发者关掉开发模式后开发插件不能再启用", () => {
  const k = new PluginKernel(new AllowStore(memSql()));
  k.put(row("d.y", {}, true));
  assert.ok(!k.setEnabled(ADMIN, "d.y", true), "没开开发模式");
  k.setDevMode(ADMIN, true);
  assert.ok(k.setEnabled(ADMIN, "d.y", true));
});
