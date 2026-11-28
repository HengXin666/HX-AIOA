import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { memSql } from "./sql";

const P = await import("@hx-aioa/protocol");
const { parseManifest, checkManifest, clientLevel, missingCaps, narrowSpace, parseClient, isBuildRange, buildFloor, matrixCell, CLIENT_CAPS } = P;
const { compatFor } = await import("../src/compat");
const { Market } = await import("../src/plugins/market");
const { attClient, clientOfUrl, spaceFor } = await import("../src/plugins/client");
const { Sockets } = await import("../src/sockets");

// 插件按端兼容 (#156): 清单字段, 级别, 能力表, 握手参数, 市场与工作台按端过滤
const base = (over: Record<string, unknown> = {}) => ({
  id: "alice.notes",
  name: "笔记",
  summary: "s",
  version: "1.0.0",
  readme: "README.md",
  prompt: "prompt.md",
  group: { title: "笔记" },
  api: "2",
  engines: { aioa: "^2" },
  ...over,
});
const todoSpace = (items: Record<string, unknown>[]) => ({ id: "s", title: "S", panels: [{ id: "p", title: "P", refresh: { mode: "push" }, items }] });
const ok = (raw: unknown) => {
  const m = parseManifest(raw);
  if (typeof m === "string") throw new Error(m);
  return m;
};

test("清单: clients / engines.<端> / builtWith / 组件级 clients 的格式", () => {
  assert.equal(typeof parseManifest(base({ clients: ["android", "web"], engines: { aioa: "^2", android: ">=121", web: ">=100 <200" }, builtWith: { android: 154 } })), "object");
  assert.equal(typeof parseManifest(base({ clients: ["*"] })), "object");
  for (const bad of [[], ["ios"], ["*", "web"], ["web", "web"], "android"]) assert.equal(typeof parseManifest(base({ clients: bad })), "string", JSON.stringify(bad));
  for (const r of ["^121", "121", "~1", ">=1.2", ""]) assert.equal(typeof parseManifest(base({ engines: { aioa: "^2", android: r } })), "string", r);
  assert.equal(typeof parseManifest(base({ builtWith: { android: 0 } })), "string");
  assert.equal(typeof parseManifest(base({ builtWith: { ios: 3 } })), "string");
  assert.equal(typeof parseManifest(base({ contributes: { widgets: [{ id: "alice.notes.w", clients: ["web", "x"] }] } })), "string");
  assert.equal(typeof parseManifest(base({ space: todoSpace([{ id: "t", type: "todo", clients: [] }]) })), "string");
  // api 1 只加不改: 新字段要 api 2
  const { api: _a, engines: _e, ...legacy } = base({ agent: { name: "a" } });
  assert.equal(typeof parseManifest({ ...legacy, clients: ["android"] }), "string");
  assert.ok(isBuildRange(">=121 <200") && !isBuildRange(">=1.0") && buildFloor(">=121 <200") === 121 && buildFloor("*") === 0);
});

test("clientLevel: 没写 clients 按安卓, 低于下界要更新, 超出上界或没声明不支持, * 都行", () => {
  const legacy = ok(base());
  assert.deepEqual(clientLevel(legacy, "android", 1), { level: "ok" });
  assert.deepEqual(clientLevel(legacy, "web", 999), { level: "unsupported" });
  const m = ok(base({ clients: ["android"], engines: { aioa: "^2", android: ">=121 <200" } }));
  assert.deepEqual(clientLevel(m, "android", 150), { level: "ok" });
  assert.deepEqual(clientLevel(m, "android", 100), { level: "update", need: 121 });
  assert.deepEqual(clientLevel(m, "android", 200), { level: "unsupported" });
  assert.deepEqual(clientLevel(m, "android"), { level: "ok" }, "构建号未知只看端");
  assert.deepEqual(clientLevel(ok(base({ clients: ["*"] })), "web", 1), { level: "ok" });
});

test("能力表: 缺的组件, 扩展点, 权限逐项列出; 手写界面的插件算支持; 组件级 clients 收窄后不再要求", () => {
  const m = ok(base({ space: todoSpace([{ id: "t", type: "todo" }]), contributes: { widgets: [{ id: "alice.notes.w" }] }, permissions: ["ui.webview"] }));
  assert.deepEqual(missingCaps(m, "android", 84).map((n) => n.name).sort(), ["todo", "ui.webview", "widgets"]);
  assert.deepEqual(missingCaps(m, "web", CLIENT_CAPS.web.known).map((n) => n.kind).sort(), ["item", "perm", "point", "space"]);
  const gh = ok(base({ id: "hengxin666.github", contributes: { widgets: [{ id: "hengxin666.github.card" }] } }));
  assert.equal(missingCaps(gh, "android", 121).length, 0);
  assert.equal(missingCaps(gh, "android", 120).length, 1);
  const narrow = ok(base({ contributes: { widgets: [{ id: "alice.notes.w", clients: ["android"] }] } }));
  assert.equal(missingCaps(narrow, "web", 1).length, 0);
});

test("checkManifest: 严格模式要 clients 与 engines.<端>, * 不能有界面, 构建号必须发布过, 离线降级为警告", () => {
  assert.match(checkManifest(base(), { strict: true }).errors.join(), /必须写 clients/);
  assert.equal(checkManifest(base()).errors.length, 0, "存量插件不升版本不追究");
  assert.match(checkManifest(base({ clients: ["web"] }), { strict: true }).errors.join(), /engines\.web/);
  assert.match(checkManifest(base({ clients: ["*"], space: todoSpace([{ id: "t", type: "todo" }]) })).errors.join(), /有界面贡献: 工作台, 组件 todo/);
  const todo = base({ clients: ["android", "web"], engines: { aioa: "^2", android: ">=85", web: ">=100" }, space: todoSpace([{ id: "t", type: "todo" }]) });
  assert.match(checkManifest(todo).errors.join(), /web 构建号 100 不支持: 工作台, 组件 todo/);
  const android = base({ clients: ["android"], engines: { aioa: "^2", android: ">=85" }, builtWith: { android: 154 }, space: todoSpace([{ id: "t", type: "todo" }]) });
  assert.deepEqual(checkManifest(android, { strict: true, released: () => true }).errors, []);
  assert.match(checkManifest(android, { released: () => false }).errors.join(), /没有发布过/);
  const offline = checkManifest(android, { released: () => undefined });
  assert.equal(offline.errors.length, 0);
  assert.match(offline.warns.join(), /离线/);
  const future = base({ clients: ["android"], engines: { aioa: "^2", android: `>=${CLIENT_CAPS.android.known + 1}` } });
  assert.match(checkManifest(future, { released: () => undefined }).errors.join(), /不能写未来版本/);
  assert.match(checkManifest(base({ clients: ["android"], engines: { aioa: "^2", android: "*" } })).errors.join(), /要写下界/);
  assert.equal(matrixCell(ok(android), "android"), "支持 (≥85)");
  assert.equal(matrixCell(ok(android), "web"), "不支持");
});

test("存量官方插件都写了端声明且通过能力表", async () => {
  for (const id of ["hengxin666.todo", "hengxin666.github", "hengxin666.gh"]) {
    const raw = (await import(`../../plugins/${id}/plugin.json`, { with: { type: "json" } })).default;
    const r = checkManifest(raw, { strict: true, released: () => true });
    assert.deepEqual(r.errors, [], id);
    assert.deepEqual(r.manifest?.clients, ["android"], id);
  }
});

test("握手参数: client 与 cb 解析, /compat 回带, 连接上记下, 没带当安卓", () => {
  assert.deepEqual(parseClient("web", "105"), { kind: "web", build: 105 });
  assert.deepEqual(parseClient("android", "x"), { kind: "android" });
  assert.equal(parseClient("ios", "1"), undefined);
  assert.deepEqual(parseClient("web", "0"), { kind: "web" });
  const u = (q: string) => new URL(`https://x.test/api/v1/stream?${q}`);
  assert.equal(compatFor(u("")), undefined);
  assert.deepEqual(compatFor(u("pv=2&client=web&cb=105"))?.client, { kind: "web", build: 105 });
  assert.equal(compatFor(u("client=web"))?.level, "ok");
  assert.deepEqual(attClient(u("client=android&cb=154")), { client: "android", cb: 154 });
  assert.deepEqual(attClient(u("pv=2")), {});
  assert.deepEqual(clientOfUrl(u("")), { kind: "android" });
});

test("工作台按端: 不支持的端不给插件工作台, 组件级 clients 裁剪; 推送按连接的端分别出帧", () => {
  const web = ok(base({ id: "alice.web", clients: ["web"], engines: { aioa: "^2", web: ">=1" } }));
  const kernel = { get: (id: string) => (id === web.id ? { manifest: web } : undefined) };
  const sent: Record<string, unknown[]> = { a: [], w: [] };
  const fakeWs = (k: string, a: Record<string, unknown>) => ({ send: (t: string) => sent[k]!.push(JSON.parse(t)), deserializeAttachment: () => ({ proto: "v1", role: "client", device: k, ...a }) });
  const sockets = new Sockets(() => [fakeWs("a", {}), fakeWs("w", { client: "web", cb: 105 })] as never, () => new Set());
  const core = { kernel, sockets } as never;
  const space = { ...todoSpace([{ id: "t", type: "todo", clients: ["android"] }, { id: "l", type: "list" }]), origin: "plugin:alice.web" } as never;
  assert.equal(spaceFor(core, space, { kind: "android" }), null);
  const forWeb = spaceFor(core, space, { kind: "web", build: 105 }) as { panels: { items: { id: string }[] }[] };
  assert.deepEqual(forWeb.panels[0]!.items.map((i) => i.id), ["l"]);
  const manual = { ...todoSpace([{ id: "t", type: "todo", clients: ["android"] }]), origin: "manual" } as never;
  assert.deepEqual(narrowSpace(manual, "android"), manual);
  sockets.toV1ClientsBy((a) => (a.client === "web" ? { t: "x", web: true } : null));
  assert.deepEqual([sent.a!.length, sent.w!.length], [0, 1]);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("市场: 索引的端字段带到列表 (脏数据丢掉), 拉清单跑同一套校验", async () => {
  const OFFICIAL = "https://official.test/plugins";
  const entries = [
    { id: "hengxin666.a", name: "A", summary: "s", version: "1.0.0", clients: ["web"], engines: { aioa: "^2", web: ">=1" } },
    { id: "hengxin666.b", name: "B", summary: "s", version: "1.0.0", clients: ["ios"], engines: "x" },
    { id: "hengxin666.c", name: "C", summary: "s", version: "1.0.0" },
  ];
  const bad = base({ id: "hengxin666.c", clients: ["*"], space: todoSpace([{ id: "t", type: "todo" }]) });
  globalThis.fetch = (async (url: string) => {
    if (url === `${OFFICIAL}/index.json`) return new Response(JSON.stringify({ plugins: entries }));
    if (url === `${OFFICIAL}/hengxin666.c/plugin.json`) return new Response(JSON.stringify(bad));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const market = new Market(OFFICIAL, memSql(), async () => "t");
  const list = await market.index();
  assert.deepEqual(list.find((p) => p.id === "hengxin666.a")?.clients, ["web"]);
  const b = list.find((p) => p.id === "hengxin666.b")!;
  assert.equal(b.clients, undefined);
  assert.equal(b.engines, undefined);
  assert.equal(clientLevel(b, "web", 1).level, "unsupported", "没写端字段按安卓");
  await assert.rejects(market.manifest("hengxin666.c"), /有界面贡献/);
});
