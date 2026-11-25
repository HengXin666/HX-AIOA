import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { memSql } from "./sql";

const { HXOA_PLUGIN, isRisky, parseHxoaConn, parseHxoaExec, parseHxoaMkdir, parseManifest } = await import("@hx-aioa/protocol");
const { HxoaService } = await import("../src/hxoa/service");
const { ApiFail } = await import("../src/http");

const env = { TOKEN_SECRET: "s3cret" } as never;
const raw = JSON.parse(readFileSync(new URL("../../plugins/hengxin666.hxoa/plugin.json", import.meta.url), "utf8"));
const TOKEN = "tok-abcdefgh";

type Call = { url: string; auth: string | null; body?: unknown };

/** 假 hxoa: 只认 TOKEN, 记下每次调用。 */
function fakeHxoa(calls: Call[]) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("Authorization");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, auth, body });
    if (auth !== `Bearer ${TOKEN}`) return Response.json({ ok: false, error: "令牌无效或已被删除", code: "unauthorized" }, { status: 401 });
    const u = new URL(url);
    if (u.pathname === "/v1/hello") return Response.json({ ok: true, server: "hxoad", workspace: "HX-AIOA", identity: "oa_2", root: "/r", mode: "worker", branch: "hxoa/oa_2-x", base_branch: "main", exec: true });
    if (u.pathname === "/v1/ls") return Response.json({ ok: true, entries: [{ p: "a", d: true }, { p: "b.txt", b: 3 }] });
    if (u.pathname === "/v1/read") return Response.json({ ok: true, version: "v1", lines: 2, start: 1, end: 2, content: "x\ny\n" });
    if (u.pathname === "/v1/mkdir") return Response.json({ ok: true, created: true });
    if (u.pathname === "/v1/exec") return Response.json({ ok: true, code: 0, stdout: "o".repeat(300 * 1024), stderr: "", ms: 12 });
    return Response.json({ ok: false, error: "not found", code: "not_found" }, { status: 404 });
  };
}

test("hxoa 清单: api 2, 无 Agent, net 权限是高危", () => {
  const m = parseManifest(raw);
  if (typeof m === "string") assert.fail(m);
  assert.equal(m.id, HXOA_PLUGIN);
  assert.equal(m.agent, undefined);
  assert.ok((m.permissions ?? []).some(isRisky));
});

test("接入参数: 只收 https (本机可 http), 去掉末尾斜杠, 拒绝带账号或参数", () => {
  assert.deepEqual(parseHxoaConn({ name: " A ", base: "https://fs.example.com/", token: TOKEN }), { name: "A", base: "https://fs.example.com", token: TOKEN });
  assert.equal(typeof parseHxoaConn({ name: "A", base: "http://fs.example.com", token: TOKEN }), "string");
  assert.equal(typeof parseHxoaConn({ name: "A", base: "http://127.0.0.1:7070", token: TOKEN }), "object");
  assert.equal(typeof parseHxoaConn({ name: "A", base: "https://u:p@x.com", token: TOKEN }), "string");
  assert.equal(typeof parseHxoaConn({ name: "A", base: "https://x.com/?a=1", token: TOKEN }), "string");
  assert.equal(typeof parseHxoaConn({ name: "", base: "https://x.com", token: TOKEN }), "string");
  assert.equal(typeof parseHxoaConn({ name: "A", base: "https://x.com", token: "short" }), "string");
  assert.equal(typeof parseHxoaExec({ cmd: "ls", timeout: 61 }), "string");
  assert.equal(parseHxoaMkdir({ path: "/a/b/" }), "a/b");
  assert.equal(parseHxoaMkdir({ path: "a/../b" }), "");
  assert.equal(parseHxoaMkdir({ path: "a//b" }), "");
  assert.equal(parseHxoaMkdir({ path: "" }), "");
  assert.deepEqual(parseHxoaExec({ cmd: "git status", dir: "server", timeout: 5 }), { cmd: "git status", dir: "server", timeout: 5 });
});

test("服务: 加接入先验证, 令牌加密落库不回给客户端, 操作带令牌转发, 输出截断", async () => {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = fakeHxoa(calls) as typeof fetch;
  try {
    const sql = memSql();
    const s = new HxoaService(env, sql);
    await assert.rejects(s.add({ name: "坏", base: "https://h.example", token: "wrong-token" }), (e: unknown) => e instanceof ApiFail && e.status === 401);
    const c = await s.add({ name: "VPS", base: "https://h.example", token: TOKEN }, 1);
    assert.equal(c.hello?.branch, "hxoa/oa_2-x");
    assert.equal(c.hello?.base, "main");
    const stored = sql.exec<{ token: string }>("SELECT token FROM hxoa_conn").toArray()[0]?.token ?? "";
    assert.ok(stored && !stored.includes(TOKEN));
    const list = await s.list();
    assert.equal(list.length, 1);
    assert.ok(!JSON.stringify(list).includes(TOKEN));
    assert.equal(list[0]?.hello?.workspace, "HX-AIOA");
    assert.deepEqual((await s.ls(c.id, "", 1)).entries.length, 2);
    assert.equal((await s.read(c.id, "b.txt")).content, "x\ny\n");
    assert.deepEqual(await s.mkdir(c.id, "a/新"), { created: true });
    assert.deepEqual(calls.at(-1)?.body, { path: "a/新" });
    const ex = await s.exec(c.id, { cmd: "ls", dir: "a" });
    assert.equal(ex.truncated, true);
    assert.equal(ex.stdout.length, 256 * 1024);
    const last = calls.at(-1);
    assert.deepEqual(last?.body, { cmd: "ls", dir: "a", timeout: 60 });
    assert.ok(calls.slice(1).every((x) => x.auth === `Bearer ${TOKEN}`));
    s.rename(c.id, "新名");
    assert.equal((await s.list())[0]?.name, "新名");
    assert.throws(() => s.rename("nope", "x"), (e: unknown) => e instanceof ApiFail && e.status === 404);
    assert.equal(s.remove(c.id), true);
    assert.equal(s.purge(), 0);
  } finally {
    globalThis.fetch = real;
  }
});

test("服务: 连不上的接入在列表里带 error, 不影响别的", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = fakeHxoa([]) as typeof fetch;
  try {
    const sql = memSql();
    const s = new HxoaService(env, sql);
    await s.add({ name: "ok", base: "https://h.example", token: TOKEN }, 1);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith("https://down.example") ? Promise.reject(new Error("boom")) : fakeHxoa([])(input, init))) as typeof fetch;
    sql.exec("INSERT INTO hxoa_conn (id, name, base, token, at) SELECT 'd', 'down', 'https://down.example', token, 2 FROM hxoa_conn");
    const list = await s.list();
    assert.equal(list.length, 2);
    assert.ok(list[0]?.hello);
    assert.match(list[1]?.error ?? "", /连不上 hxoa/);
  } finally {
    globalThis.fetch = real;
  }
});
