import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { memSql } from "./sql";

const { parseManifest } = await import("@hx-aioa/protocol");
const { AllowStore } = await import("../src/plugins/allow-store");
const { PluginKernel } = await import("../src/plugins/kernel");
const { Market, entryBad } = await import("../src/plugins/market");
const { relocateOfficial } = await import("../src/plugins/relocate");

// 插件从官方源搬到主人私有源 (#124): 已放行, 已启用的平滑迁移
const ID = "hengxin666.hxoa";
const OWNER = "u-owner";
const BOB = "u-bob";
const OFFICIAL = "https://official.test/plugins";
const PRIVATE = "https://github.com/HengXin666/aioa-private-plugins";
const PRIV_RAW = "https://raw.githubusercontent.com/HengXin666/aioa-private-plugins/HEAD";
const raw = { id: ID, name: "hxoa 管理", summary: "s", version: "2.0.0", readme: "README.md", prompt: "prompt.md", group: { title: "hxoa" }, api: "2", server: true, engines: { aioa: "^2" }, permissions: ["net:*"] };
const entry = { id: ID, name: "hxoa 管理", summary: "s", version: "2.0.0" };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** official: 官方索引里的条目, null 表示官方源连不上; 私有仓库公开读 404, 带令牌才读得到。 */
function stub(official: unknown[] | null, priv: unknown[] = [entry]) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const auth = !!(init?.headers as Record<string, string> | undefined)?.Authorization;
    if (url === `${OFFICIAL}/index.json`) return official ? new Response(JSON.stringify({ plugins: official })) : new Response("坏了", { status: 500 });
    if (url.startsWith(PRIV_RAW) && auth) {
      if (url === `${PRIV_RAW}/index.json`) return new Response(JSON.stringify({ name: "私有插件", plugins: priv }));
      if (url === `${PRIV_RAW}/${ID}/plugin.json`) return new Response(JSON.stringify(raw));
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

function setup(official: unknown[] | null) {
  stub(official);
  const sql = memSql();
  const market = new Market(OFFICIAL, sql, async () => "t");
  const kernel = new PluginKernel(new AllowStore(sql));
  const m = parseManifest({ ...raw, version: "1.0.0" });
  if (typeof m === "string") throw new Error(m);
  kernel.put({ meta: { id: ID, version: "1.0.0", name: m.name, by: OWNER, at: 1 }, manifest: m, prompt: "" });
  kernel.setEnabled(OWNER, ID, true);
  kernel.setEnabled(BOB, ID, true);
  const core = { kernel, market, users: { ownerId: () => OWNER }, sockets: { clients: () => [], chatSockets: () => [] } };
  return { sql, market, kernel, core: core as never };
}

test("源规则: 私有源可以接手官方命名空间, 普通第三方源不行, 旧别名都不行", () => {
  assert.equal(entryBad(ID, { official: true }), null);
  assert.equal(entryBad(ID, { private: true }), null);
  assert.equal(entryBad("foo.bar", { private: true }), null);
  assert.equal(entryBad(ID, {}), "官方命名空间");
  assert.equal(entryBad("hengxin666.new", {}), "官方命名空间");
  assert.notEqual(entryBad("todo", { private: true }), null);
  assert.equal(entryBad("foo.bar", {}), null);
});

test("私有源能提供这次部署里的服务端插件 (官方命名空间, server: true)", async () => {
  const { market } = setup([]);
  const src = await market.addSource(PRIVATE, true);
  assert.equal(src.private, true);
  assert.deepEqual(src.skipped, undefined);
  const { m, src: at } = await market.manifestAt(ID, "latest");
  assert.equal(m.version, "2.0.0");
  assert.equal(at.id, src.id);
});

test("官方源下架, 私有源接手: 白名单换源标私有, 快照与主人启用不动, 子号停用", async () => {
  const { sql, market, kernel, core } = setup([]);
  await market.addSource(PRIVATE, true);
  assert.deepEqual(await relocateOfficial(core), [ID]);
  const meta = kernel.get(ID)!.meta;
  assert.equal(meta.private, true);
  assert.equal(meta.source, "hengxin666-aioa-private-plugins");
  assert.equal(meta.version, "1.0.0");
  assert.ok(kernel.isEnabled(OWNER, ID));
  assert.ok(!kernel.isEnabled(BOB, ID));
  // 只做一次: 已经记的是私有源, 再跑不动
  assert.deepEqual(await relocateOfficial(core), []);
  const again = new PluginKernel(new AllowStore(sql));
  assert.equal(again.get(ID)!.meta.private, true);
  assert.ok(again.isEnabled(OWNER, ID));
});

test("官方源还在或连不上时不迁移", async () => {
  const still = setup([entry]);
  await still.market.addSource(PRIVATE, true);
  assert.deepEqual(await relocateOfficial(still.core), []);
  assert.equal(still.kernel.get(ID)!.meta.source, undefined);
  const down = setup(null);
  await down.market.addSource(PRIVATE, true);
  assert.deepEqual(await relocateOfficial(down.core), []);
  assert.ok(down.kernel.isEnabled(BOB, ID));
});

test("私有源授权过期 (拉不到): 已迁移的照常启用, 门控不依赖市场", async () => {
  const { market, kernel, core } = setup([]);
  await market.addSource(PRIVATE, true);
  await relocateOfficial(core);
  globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  await market.refresh();
  assert.ok(kernel.isEnabled(OWNER, ID));
  assert.equal(kernel.get(ID)!.meta.version, "1.0.0");
});
