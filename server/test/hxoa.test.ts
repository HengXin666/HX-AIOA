import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { memSql } from "./sql";

const { HXOA_PLUGIN, HXOA_KIND_AGENT, isRisky, isHxoaId, parseHxoaConn, parseHxoaLabel, parseHxoaMkdir, parseHxoaWs, parseHxoaWsPatch, parseManifest } = await import("@hx-aioa/protocol");
const { HxoaService } = await import("../src/hxoa/service");
const { ApiFail } = await import("../src/http");

const env = { TOKEN_SECRET: "s3cret" } as never;
const raw = JSON.parse(readFileSync(new URL("../../plugins/hengxin666.hxoa/plugin.json", import.meta.url), "utf8"));
const TOKEN = "hxadm_abcdefgh12345678";
const SECRET = "hx_workspace_secret_1";

type Call = { method: string; path: string; auth: string | null; body?: unknown };

const STATE = {
  ok: true,
  server: "hxoad/2.4.0",
  public_url: "https://h.example",
  tunnel: { mode: "token", state: "running", url: "https://h.example" },
  workspaces: [
    {
      id: "a1b2",
      name: "ai-dev",
      path: "/home/loli/ai-dev",
      workers: true,
      exec: true,
      git: true,
      branch: "main",
      online: 1,
      tokens: [{ id: "c3d4", secret: SECRET, label: "hark", workspace: "a1b2", online: true, last_seen: "2026-11-26T12:00:00Z", last_ip: "1.2.3.4", ops: 7, worker: { exists: true, branch: "hxoa/hark-c3d4", ahead: "1" } }],
    },
  ],
};

/** 假 hxoa: 只认 TOKEN, 走 /admin/v1/*, 记下每次调用。 */
function fakeHxoa(calls: Call[]) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(input));
    const auth = new Headers(init?.headers).get("Authorization");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? "GET";
    const path = u.pathname.replace("/admin/v1", "");
    calls.push({ method, path: path + u.search, auth, body });
    if (auth !== `Bearer ${TOKEN}`) return Response.json({ ok: false, error: "管理令牌无效或已被删除", code: "unauthorized" }, { status: 401 });
    const k = `${method} ${path}`;
    if (k === "GET /hello") return Response.json({ ok: true, server: "hxoad/2.4.0", admin: "aioa", public_url: "https://h.example" });
    if (k === "GET /state") return Response.json(STATE);
    if (k === "GET /browse") return Response.json({ ok: true, path: "/home/loli", parent: "/home", dirs: ["ai-dev", "src"], git: false });
    if (k === "POST /mkdir") return Response.json({ ok: true, path: `${body.parent}/${body.name}` });
    if (k === "POST /workspaces") return body.path === "/nope" ? Response.json({ ok: false, error: "目录不存在: /nope" }, { status: 400 }) : Response.json({ ok: true, workspace: { id: "e5f6" } });
    if (k === "POST /workspaces/a1b2/tokens") return Response.json({ ok: true, token: { id: "a7a8", secret: SECRET, label: body.label, ops: 0 }, prompt: `hxoa --login ${SECRET}` });
    if (k === "GET /tokens/c3d4/prompt") return Response.json({ ok: true, prompt: `hxoa --login ${SECRET}` });
    if (["PATCH /workspaces/a1b2", "DELETE /workspaces/a1b2", "DELETE /tokens/c3d4"].includes(k)) return Response.json({ ok: true });
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  };
}

async function withFetch(calls: Call[], fn: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = fakeHxoa(calls) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test("hxoa 清单: api 2, 无 Agent, net 权限是高危", () => {
  const m = parseManifest(raw);
  if (typeof m === "string") assert.fail(m);
  assert.equal(m.id, HXOA_PLUGIN);
  assert.equal(m.agent, undefined);
  assert.ok((m.permissions ?? []).some(isRisky));
});

test("参数: 只收 https 和管理令牌, 工作区 / 改动 / 身份名 / 新建文件夹 / id 校验", () => {
  assert.deepEqual(parseHxoaConn({ name: " A ", base: "https://fs.example.com/", token: TOKEN }), { name: "A", base: "https://fs.example.com", token: TOKEN });
  assert.equal(typeof parseHxoaConn({ name: "A", base: "http://fs.example.com", token: TOKEN }), "string");
  assert.equal(typeof parseHxoaConn({ name: "A", base: "http://127.0.0.1:7070", token: TOKEN }), "object");
  assert.equal(typeof parseHxoaConn({ name: "A", base: "https://u:p@x.com", token: TOKEN }), "string");
  assert.equal(typeof parseHxoaConn({ name: "A", base: "https://x.com", token: SECRET }), "string", "工作区令牌不能当管理令牌");
  assert.deepEqual(parseHxoaWs({ path: " /home/loli/x ", name: "x" }), { name: "x", path: "/home/loli/x", workers: false, exec: true });
  assert.equal(typeof parseHxoaWs({ path: "" }), "string");
  assert.deepEqual(parseHxoaWsPatch({ exec: false }), { exec: false });
  assert.equal(typeof parseHxoaWsPatch({}), "string");
  assert.equal(typeof parseHxoaWsPatch({ workers: "yes" }), "string");
  assert.equal(parseHxoaLabel({ label: "hark" }), "hark");
  assert.equal(parseHxoaLabel({ label: "坏 名" }), "");
  assert.deepEqual(parseHxoaMkdir({ parent: "/home/loli", name: "新" }), { parent: "/home/loli", name: "新" });
  assert.equal(typeof parseHxoaMkdir({ parent: "/home", name: "a/b" }), "string");
  assert.equal(typeof parseHxoaMkdir({ parent: "/home", name: ".." }), "string");
  assert.ok(isHxoaId("a1b2"));
  assert.ok(!isHxoaId("../admin-tokens"));
});

test("服务: 接入先验证, 管理令牌加密落库; 状态去掉连接令牌密钥; 增删改都带管理令牌转发", async () => {
  const calls: Call[] = [];
  await withFetch(calls, async () => {
    const sql = memSql();
    const s = new HxoaService(env, sql);
    await assert.rejects(s.add({ name: "坏", base: "https://h.example", token: "hxadm_wrong" }), (e: unknown) => e instanceof ApiFail && e.status === 401);
    const c = await s.add({ name: "VPS", base: "https://h.example", token: TOKEN }, 1);
    assert.equal(c.hello?.admin, "aioa");
    const stored = sql.exec<{ token: string }>("SELECT token FROM hxoa_conn").toArray()[0]?.token ?? "";
    assert.ok(stored && !stored.includes(TOKEN));
    const list = await s.list();
    assert.ok(!JSON.stringify(list).includes(TOKEN));
    const st = await s.state(c.id);
    assert.equal(st.workspaces[0]?.tokens[0]?.worker?.branch, "hxoa/hark-c3d4");
    assert.equal(st.workspaces[0]?.tokens[0]?.lastSeen, "2026-11-26T12:00:00Z");
    assert.ok(!JSON.stringify(st).includes(SECRET), "连接令牌密钥不能下发");
    assert.deepEqual((await s.browse(c.id, "~")).dirs, ["ai-dev", "src"]);
    assert.equal(calls.at(-1)?.path, "/browse?path=%7E");
    assert.deepEqual(await s.mkdir(c.id, "/home/loli", "新"), { path: "/home/loli/新" });
    assert.deepEqual(await s.addWorkspace(c.id, { name: "x", path: "/home/loli/新", workers: false, exec: true }), { id: "e5f6" });
    await assert.rejects(s.addWorkspace(c.id, { name: "", path: "/nope", workers: false, exec: true }), (e: unknown) => e instanceof ApiFail && e.status === 400 && /目录不存在/.test(e.message));
    await s.patchWorkspace(c.id, "a1b2", { exec: false });
    assert.deepEqual(calls.at(-1), { method: "PATCH", path: "/workspaces/a1b2", auth: `Bearer ${TOKEN}`, body: { exec: false } });
    const nt = await s.addToken(c.id, "a1b2", "claude");
    assert.equal(nt.token.label, "claude");
    assert.ok(nt.prompt.includes(SECRET), "连接提示本来就要带令牌");
    assert.ok(!JSON.stringify(nt.token).includes(SECRET));
    assert.match((await s.prompt(c.id, "c3d4")).prompt, /hxoa --login/);
    await s.deleteToken(c.id, "c3d4");
    await s.deleteWorkspace(c.id, "a1b2");
    assert.ok(calls.slice(1).every((x) => x.auth === `Bearer ${TOKEN}`));
    s.rename(c.id, "新名");
    assert.equal((await s.list())[0]?.name, "新名");
    assert.throws(() => s.rename("nope", "x"), (e: unknown) => e instanceof ApiFail && e.status === 404);
    assert.equal(s.remove(c.id), true);
    assert.equal(s.purge(), 0);
  });
});

test("服务: #97 旧版工作区令牌行升级后标 agent, 列表提示重接, 操作 409, 能删", async () => {
  const calls: Call[] = [];
  await withFetch(calls, async () => {
    const sql = memSql();
    sql.exec("CREATE TABLE hxoa_conn (id TEXT PRIMARY KEY, name TEXT NOT NULL, base TEXT NOT NULL, token TEXT NOT NULL, at INTEGER NOT NULL)");
    sql.exec("INSERT INTO hxoa_conn (id, name, base, token, at) VALUES ('old', 'VPS', 'https://h.example', 'x', 1)");
    const s = new HxoaService(env, sql);
    const list = await s.list();
    assert.equal(list[0]?.kind, HXOA_KIND_AGENT);
    assert.match(list[0]?.error ?? "", /管理令牌/);
    assert.equal(calls.length, 0, "旧行不去连");
    await assert.rejects(s.state("old"), (e: unknown) => e instanceof ApiFail && e.status === 409);
    assert.equal(s.remove("old"), true);
  });
});

test("服务: 连不上的接入在列表里带 error, 不影响别的", async () => {
  await withFetch([], async () => {
    const sql = memSql();
    const s = new HxoaService(env, sql);
    await s.add({ name: "ok", base: "https://h.example", token: TOKEN }, 1);
    const ok = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith("https://down.example") ? Promise.reject(new Error("boom")) : ok(input, init))) as typeof fetch;
    sql.exec("INSERT INTO hxoa_conn (id, name, base, token, at, kind) SELECT 'd', 'down', 'https://down.example', token, 2, kind FROM hxoa_conn");
    const list = await s.list();
    assert.equal(list.length, 2);
    assert.ok(list[0]?.hello);
    assert.match(list[1]?.error ?? "", /连不上 hxoa/);
  });
});
