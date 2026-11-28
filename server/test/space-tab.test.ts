import assert from "node:assert/strict";
import { test } from "node:test";
import { memSql } from "./sql";

const { demoteTab, isIconRef, parseHomeTabs, parseManifest, parseSpaceState, validateSpace, pluginSpaceId } = await import("@hx-aioa/protocol");
const { AllowStore } = await import("../src/plugins/allow-store");
const { PluginKernel } = await import("../src/plugins/kernel");
const { Market } = await import("../src/plugins/market");
const { applySpace } = await import("../src/plugins/update");
const { Spaces } = await import("../src/spaces");
const { Config } = await import("../src/config");

// 顶部标签的空间提示 tab (#139): 校验, 可信来源才能 primary, 首页标签设置跟账号走
const ID = "hengxin666.todo";
const OWNER = "u-owner";
const space = (tab?: unknown) => ({ id: "todo", title: "点子待办", panels: [], ...(tab === undefined ? {} : { tab }) });
const manifest = (tab?: unknown) => ({
  id: ID, name: "点子待办", summary: "s", version: "2.3.1", readme: "README.md", prompt: "prompt.md",
  group: { title: "点子待办" }, agent: { name: "整理员" }, api: "2", engines: { aioa: "^2" }, space: space(tab),
});

function fakeStorage() {
  const kv = new Map<string, unknown>();
  return {
    get: async (k: string) => kv.get(k),
    put: async (k: string, v: unknown) => void kv.set(k, v),
    delete: async (k: string) => kv.delete(k),
  } as unknown as DurableObjectStorage;
}

/** meta: 白名单记录的来源 (缺省是官方源)。 */
function setup(meta: Record<string, unknown> = {}) {
  const sql = memSql();
  const kernel = new PluginKernel(new AllowStore(sql));
  const m = parseManifest(manifest("primary"));
  if (typeof m === "string") throw new Error(m);
  kernel.put({ meta: { id: ID, version: m.version, name: m.name, by: OWNER, at: 1, ...meta }, manifest: m, prompt: "" });
  const spaces = new Spaces(fakeStorage());
  const core = { kernel, market: new Market("https://official.test/plugins", sql, async () => "t"), spaces, users: { ownerId: () => OWNER }, sockets: { toV1Clients: () => {}, toV1ClientsBy: () => {} } };
  return { m, spaces, core: core as never };
}

test("tab 只认 primary/auto/none, 空间与插件清单都校验", () => {
  for (const t of ["primary", "auto", "none"]) assert.deepEqual(validateSpace(space(t)), []);
  assert.deepEqual(validateSpace(space()), []);
  assert.match(validateSpace(space("top")).join(), /tab 只能是/);
  assert.match(String(parseManifest(manifest("pin"))), /space.tab 只能是/);
  assert.equal(typeof parseManifest(manifest("primary")), "object");
});

test("demoteTab: primary 降为 auto, 其余原样", () => {
  assert.equal(demoteTab(space("primary")).tab, "auto");
  assert.equal(demoteTab(space("none")).tab, "none");
  assert.equal("tab" in demoteTab(space()), false);
  assert.equal(demoteTab(null), null);
});

test("官方源与主人私有源的插件能 primary; 第三方源与开发模式降为 auto", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{}, "primary"],
    [{ source: "official" }, "primary"],
    [{ source: "hengxin666-aioa-private-plugins", private: true }, "primary"],
    [{ source: "alice-plugins" }, "auto"],
    [{ dev: true }, "auto"],
  ];
  for (const [meta, want] of cases) {
    const { m, spaces, core } = setup(meta);
    await applySpace(core, ID, m, "plugin-todo", "点子待办");
    assert.equal((await spaces.get(pluginSpaceId(ID)))?.tab, want, JSON.stringify(meta));
  }
});

test("空间 state 的 pinned / hidden 可以用 null 清掉 (恢复默认)", () => {
  const s = { ...space(), panels: [] };
  assert.deepEqual(parseSpaceState({ pinned: null }, s, { pinned: true, hidden: true }), { hidden: true });
  assert.match(String(parseSpaceState({ pinned: "yes" }, s)), /布尔值或 null/);
});

test("homeTabs: 只认 order 与 pins, 长度与类型都校验", () => {
  assert.deepEqual(parseHomeTabs({ order: ["#daily", "CHAT"], pins: { AGENT: false } }), { order: ["#daily", "CHAT"], pins: { AGENT: false } });
  assert.deepEqual(parseHomeTabs({}), { order: [], pins: {} });
  assert.equal(typeof parseHomeTabs([]), "string");
  assert.match(String(parseHomeTabs({ order: [], x: 1 })), /不认识的键/);
  assert.match(String(parseHomeTabs({ order: ["a", "a"] })), /重复/);
  assert.match(String(parseHomeTabs({ order: [1] })), /order/);
  assert.match(String(parseHomeTabs({ order: Array.from({ length: 65 }, (_, i) => `t${i}`) })), /最多 64/);
  assert.match(String(parseHomeTabs({ pins: { CHAT: 1 } })), /pins/);
  assert.match(String(parseHomeTabs({ pins: { ["x".repeat(129)]: true } })), /pins/);
});

test("自选图标 (#142): 图标名或 img: / svg: 加上传 id; homeTabs.icons 与 state.icon 都校验, null 清掉", () => {
  for (const ok of ["server", "code-xml", "img:0123456789abcdef01234567", "svg:abcdef01"]) assert.equal(isIconRef(ok), true, ok);
  for (const bad of ["", "Server", "img:", "img:xyz", "png:abcdef01", "javascript:alert(1)", "a".repeat(49), 3]) assert.equal(isIconRef(bad), false, String(bad));
  assert.deepEqual(parseHomeTabs({ order: [], pins: {}, icons: { CHAT: "mail", "#daily": "svg:abcdef01" } }), { order: [], pins: {}, icons: { CHAT: "mail", "#daily": "svg:abcdef01" } });
  assert.deepEqual(parseHomeTabs({ icons: {} }), { order: [], pins: {} });
  assert.match(String(parseHomeTabs({ icons: { CHAT: "<svg>" } })), /icons/);
  assert.match(String(parseHomeTabs({ icons: [] })), /icons/);
  const s = { ...space(), panels: [] };
  assert.deepEqual(parseSpaceState({ icon: "img:0123456789abcdef01234567" }, s, { hidden: true }), { hidden: true, icon: "img:0123456789abcdef01234567" });
  assert.deepEqual(parseSpaceState({ icon: null }, s, { icon: "server" }), {});
  assert.match(String(parseSpaceState({ icon: "https://x/y.svg" }, s)), /icon/);
});

test("PATCH settings 的 homeTabs: 校验后存, null 删掉", async () => {
  const cfg = new Config(fakeStorage());
  assert.match(String(await cfg.patchSettings({ homeTabs: { pins: { CHAT: "on" } } })), /^homeTabs: /);
  const r = await cfg.patchSettings({ homeTabs: { order: ["CHAT"], pins: { RESOURCES: true } } });
  assert.deepEqual((r as Record<string, unknown>).homeTabs, { order: ["CHAT"], pins: { RESOURCES: true } });
  const gone = await cfg.patchSettings({ homeTabs: null });
  assert.equal("homeTabs" in (gone as object), false);
});
