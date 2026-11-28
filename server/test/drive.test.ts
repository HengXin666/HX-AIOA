import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "../src/env";

const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
subtle.timingSafeEqual ??= (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
(globalThis as Record<string, unknown>).FixedLengthStream ??= class extends TransformStream {
  constructor(_n: number) {
    super();
  }
};

const { normalizeDrivePath, isDriveName, isDriveReadonly, HEADER_DRIVE_PASS } = await import("@hx-aioa/protocol");
const { driveWorker } = await import("../src/drive/worker");
const { signPass } = await import("../src/drive/pass");
const { DRIVE_ROUTES } = await import("../src/drive/api");

const BASE = "https://aioa.example";
type Call = { method: string; path: string; auth: string | null; body?: unknown };

/** 假 Drive: 记下每次调用; stat 按 id 给路径, 根目录的绝对路径由 rootAbs 决定。 */
function fakeDrive(calls: Call[], rootAbs = "/", paths: Record<string, string> = {}, chunkUrl?: string) {
  return {
    async fetch(req: Request): Promise<Response> {
      const u = new URL(req.url);
      const body = req.headers.get("content-type")?.includes("json") ? await req.json() : undefined;
      calls.push({ method: req.method, path: u.pathname + u.search, auth: req.headers.get("authorization"), body });
      const p = u.pathname.replace("/api/v1", "");
      if (p === "/fs/stat") {
        const id = u.searchParams.get("id");
        if (!id) return Response.json({ node: { id: "root" }, path: rootAbs });
        return paths[id] ? Response.json({ node: { id }, path: paths[id] }) : Response.json({ error: "not found" }, { status: 404 });
      }
      if (p === "/fs/list") return Response.json({ node: { id: "d", kind: "dir" }, path: "/x", children: [{ id: "n1", name: "a.txt", kind: "file", size: 3 }] });
      if (p === "/shares" && req.method === "GET") return Response.json({ items: [{ id: "abcdef1234", node_id: "n1", expires_at: null, created_at: 1, name: "a.txt", has_password: 1 }] });
      if (p === "/admin/stats") return Response.json({ error: "missing scope: stats" }, { status: 403 });
      if (p === "/fs/move") return Response.json({ error: "target exists" }, { status: 409 });
      if (p === "/uploads") return Response.json({ done: false, ticket: "t", chunkSize: 8, chunkCount: 1, ...(chunkUrl ? { chunkUrl } : {}) });
      if (p === "/fs/copy") return Response.json({ node: { id: "c1", name: "x", kind: "file", size: 1 } });
      return Response.json({ ok: true });
    },
  };
}

function envOf(calls: Call[], opts: { whole?: boolean; drive?: boolean; rootAbs?: string; paths?: Record<string, string>; origin?: string; chunkUrl?: string } = {}): Env {
  return {
    TOKEN_SECRET: "k",
    AUTH_TOKEN: "owner-token",
    CFD_ORIGIN: opts.origin ?? "https://drive.example",
    CFD_TOKEN: "hxd_aioa",
    ...(opts.whole === false ? {} : { CFD_DRIVE_TOKEN: "hxd_whole" }),
    ...(opts.drive === false ? {} : { DRIVE: fakeDrive(calls, opts.rootAbs, opts.paths, opts.chunkUrl) }),
  } as unknown as Env;
}

async function call(env: Env, method: string, path: string, opts: { pass?: string | null; body?: unknown; headers?: Record<string, string> } = {}) {
  const pass = opts.pass === undefined ? (await signPass(env, "u_owner")).pass : opts.pass;
  const headers: Record<string, string> = { ...opts.headers };
  if (pass) headers[HEADER_DRIVE_PASS] = pass;
  const url = new URL(path, BASE);
  const req = new Request(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return driveWorker(req, env, url);
}

test("路径规范化: 合并 /, 拒绝 . .. 反斜杠与相对路径", () => {
  assert.equal(normalizeDrivePath("//a///b/"), "/a/b");
  assert.equal(normalizeDrivePath("/"), "/");
  assert.equal(normalizeDrivePath("/a/../b"), null);
  assert.equal(normalizeDrivePath("/a/./b"), null);
  assert.equal(normalizeDrivePath("a/b"), null);
  assert.equal(normalizeDrivePath("/a\\b"), null);
  assert.equal(normalizeDrivePath("/a\u0000"), null);
  assert.equal(isDriveName("a/b"), false);
  assert.equal(isDriveName(".."), false);
  assert.equal(isDriveName("报告.pdf"), true);
});

test("附件目录只读: 整盘在 /aioa 下, 退回时在令牌根下", () => {
  assert.equal(isDriveReadonly("/aioa", true), true);
  assert.equal(isDriveReadonly("/aioa/2026-11/f_1_a.png", true), true);
  assert.equal(isDriveReadonly("/aioa/备份", true), false);
  assert.equal(isDriveReadonly("/2026-11", false), true);
  assert.equal(isDriveReadonly("/照片", false), false);
});

test("没有通行证, 签名不对或过期都 401, 不碰 Drive", async () => {
  const calls: Call[] = [];
  const env = envOf(calls);
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/", { pass: null }))?.status, 401);
  const { pass } = await signPass(env, "u_owner");
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/", { pass: pass.replace(/.$/, (c) => (c === "0" ? "1" : "0")) }))?.status, 401);
  const old = await signPass(env, "u_owner", Date.now() - 2 * 3600_000);
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/", { pass: old.pass }))?.status, 401);
  assert.equal(calls.length, 0);
});

test("AUTH_TOKEN 也能用; 没接入 Drive 时 503; pass / save / attach 交给 Hub", async () => {
  const calls: Call[] = [];
  const r = await call(envOf(calls), "GET", "/api/v1/drive/list?path=/", { pass: null, headers: { authorization: "Bearer owner-token" } });
  assert.equal(r?.status, 200);
  assert.equal((await call(envOf([], { drive: false }), "GET", "/api/v1/drive/list?path=/"))?.status, 503);
  assert.equal(await call(envOf([]), "POST", "/api/v1/drive/pass", { body: {} }), null);
  assert.equal(await call(envOf([]), "POST", "/api/v1/drive/attach", { body: {} }), null);
  assert.equal(await call(envOf([]), "GET", "/api/v1/files"), null);
});

test("列目录: 路径穿越 400 且不转发; 正常转发并带 ETag, 再问 304", async () => {
  const calls: Call[] = [];
  const env = envOf(calls);
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/a/../etc"))?.status, 400);
  assert.equal(calls.length, 0);
  const r = (await call(env, "GET", "/api/v1/drive/list?path=//docs/"))!;
  assert.equal(r.status, 200);
  const listed = calls.find((x) => x.path.startsWith("/api/v1/fs/list"));
  assert.equal(listed?.path, "/api/v1/fs/list?path=%2Fdocs");
  assert.equal(listed?.auth, "Bearer hxd_whole");
  const body = await r.json<{ path: string; items: unknown[] }>();
  assert.deepEqual([body.path, body.items.length], ["/docs", 1]);
  const again = await call(env, "GET", "/api/v1/drive/list?path=/docs", { headers: { "if-none-match": r.headers.get("etag")! } });
  assert.equal(again?.status, 304);
});

test("附件目录里删, 移, 建都 409, 不转发写操作", async () => {
  const calls: Call[] = [];
  const env = envOf(calls, { paths: { att: "/aioa/2026-11/f_1_a.png", doc: "/docs/a.txt" } });
  assert.equal((await call(env, "POST", "/api/v1/drive/delete", { body: { id: "att" } }))?.status, 409);
  assert.equal((await call(env, "POST", "/api/v1/drive/move", { body: { id: "doc", toPath: "/aioa/2026-11" } }))?.status, 409);
  assert.equal((await call(env, "POST", "/api/v1/drive/mkdir", { body: { path: "/aioa/2026-12/x" } }))?.status, 409);
  assert.equal((await call(env, "POST", "/api/v1/drive/uploads", { body: { path: "/aioa", name: "a", size: 1 } }))?.status, 409);
  assert.ok(!calls.some((c) => c.path.startsWith("/api/v1/fs/delete") || c.path.startsWith("/api/v1/fs/move") || c.path.startsWith("/api/v1/fs/mkdir")));
  assert.equal((await call(env, "POST", "/api/v1/drive/delete", { body: { id: "doc" } }))?.status, 200);
});

test("退回 CFD_TOKEN: 绝对路径换成令牌根下的相对路径再判只读", async () => {
  const calls: Call[] = [];
  const env = envOf(calls, { whole: false, rootAbs: "/aioa", paths: { att: "/aioa/2026-11/f_1", mine: "/aioa/照片/a.png" }, origin: "https://fallback.example" });
  assert.equal((await call(env, "POST", "/api/v1/drive/delete", { body: { id: "att" } }))?.status, 409);
  assert.equal((await call(env, "POST", "/api/v1/drive/delete", { body: { id: "mine" } }))?.status, 200);
  assert.equal(calls.at(-1)?.auth, "Bearer hxd_aioa");
});

test("参数校验: 坏 id, 坏名字, 改名不给目标; Drive 的英文报错转成中文", async () => {
  const calls: Call[] = [];
  const env = envOf(calls, { paths: { doc: "/docs/a.txt" } });
  assert.equal((await call(env, "POST", "/api/v1/drive/delete", { body: { id: "../x" } }))?.status, 400);
  assert.equal((await call(env, "POST", "/api/v1/drive/move", { body: { id: "doc", name: "a/b" } }))?.status, 400);
  assert.equal((await call(env, "POST", "/api/v1/drive/move", { body: { id: "doc" } }))?.status, 400);
  const r = (await call(env, "POST", "/api/v1/drive/move", { body: { id: "doc", name: "b.txt" } }))!;
  assert.equal(r.status, 409);
  assert.equal((await r.json<{ error: string }>()).error, "同名的文件或文件夹已存在");
  assert.equal((await call(env, "GET", "/api/v1/drive/nope"))?.status, 404);
});

test("分享列表补上公开地址; 令牌没有 stats 权限时用量为 null", async () => {
  const env = envOf([]);
  const s = await (await call(env, "GET", "/api/v1/drive/shares"))!.json<{ items: { url: string; hasPassword: boolean }[] }>();
  assert.deepEqual(s.items.map((x) => [x.url, x.hasPassword]), [["https://drive.example/s/abcdef1234", true]]);
  assert.deepEqual(await (await call(env, "GET", "/api/v1/drive/stats"))!.json(), { stats: null });
  assert.equal((await call(env, "DELETE", "/api/v1/drive/shares/..%2Fx"))?.status, 400);
});

/** 只拼出路由需要的上下文。 */
function ctx(env: Env, who: unknown, headers: Record<string, string> = {}, files: unknown = {}) {
  const url = new URL("/api/v1/drive/pass", BASE);
  return { req: new Request(url, { method: "POST", headers, body: "{}" }), url, params: [], who, core: { env, files } } as never;
}
const passRoute = DRIVE_ROUTES.find((r) => r.re.test("/api/v1/drive/pass"))!;

test("通行证只签给真主人: 子号, 转发到子号 DO 的请求都 403; 没接入 503", async () => {
  const env = envOf([]);
  const member = { owner: false, key: { id: "k", scopes: [] }, member: {} };
  assert.equal((await passRoute.handler(ctx(env, member))).status, 403);
  const sub = { owner: true, user: { id: "u_sub", role: "member" } };
  assert.equal((await passRoute.handler(ctx(env, sub))).status, 403);
  const owner = { owner: true, user: { id: "u_owner", role: "owner" } };
  assert.equal((await passRoute.handler(ctx(env, owner, { "X-Aioa-User": "x" }))).status, 403);
  assert.equal((await passRoute.handler(ctx(envOf([], { drive: false }), owner))).status, 503);
  const r = await passRoute.handler(ctx(env, owner));
  const b = await r.json<{ pass: string; root: string; whole: boolean }>();
  assert.deepEqual([r.status, b.root, b.whole], [200, "/", true]);
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/", { pass: b.pass }))?.status, 200);
});

test("申请上传: Drive 给了公网分片地址就交给 App 直传 (direct), 旧版 Drive 没有就不给 (#157)", async () => {
  const body = { path: "/docs", name: "a.bin", size: 8 };
  const neu = await (await call(envOf([], { chunkUrl: "https://drive.example/api/v1/uploads/chunk" }), "POST", "/api/v1/drive/uploads", { body }))!.json<Record<string, unknown>>();
  assert.equal(neu.direct, "https://drive.example/api/v1/uploads/chunk");
  assert.equal(neu.chunkUrl, undefined);
  const old = await (await call(envOf([]), "POST", "/api/v1/drive/uploads", { body }))!.json<Record<string, unknown>>();
  assert.deepEqual([old.ticket, old.direct], ["t", undefined]);
});

test("只配 CFD_TOKEN 但它的根在 Drive 后台改成了 /: 自动按整盘, 附件 /aioa 仍只读, 发到群复制进 /aioa/YYYY-MM (#157)", async () => {
  const calls: Call[] = [];
  const env = envOf(calls, { whole: false, rootAbs: "/", paths: { att: "/aioa/2026-11/f_1", doc: "/docs/a.txt", n1: "/docs/a.txt" }, origin: "https://moved.example" });
  const owner = { owner: true, user: { id: "u_owner", role: "owner" } };
  const p = await (await passRoute.handler(ctx(env, owner))).json<{ root: string; whole: boolean }>();
  assert.deepEqual([p.root, p.whole], ["/", true]);
  assert.equal((await call(env, "POST", "/api/v1/drive/delete", { body: { id: "att" } }))?.status, 409);
  assert.equal((await call(env, "POST", "/api/v1/drive/delete", { body: { id: "doc" } }))?.status, 200);
  const files = { drive: {}, create: () => ({ id: "f_x", name: "a.txt", size: 1, mime: "text/plain" }), done: () => true };
  const attach = DRIVE_ROUTES.find((r) => r.re.test("/api/v1/drive/attach"))!;
  const c = { req: new Request(new URL("/api/v1/drive/attach", BASE), { method: "POST", body: JSON.stringify({ id: "n1" }) }), url: new URL("/api/v1/drive/attach", BASE), params: [], who: owner, core: { env, files } } as never;
  calls.length = 0;
  const fake = (env as unknown as { DRIVE: { fetch: (r: Request) => Promise<Response> } }).DRIVE;
  const orig = fake.fetch.bind(fake);
  fake.fetch = async (req) => (new URL(req.url).searchParams.get("id") === "n1" ? Response.json({ node: { id: "n1", name: "a.txt", kind: "file", size: 1, mime: "text/plain" }, path: "/docs/a.txt" }) : orig(req));
  assert.equal((await attach.handler(c)).status, 200);
  const copy = calls.find((x) => x.path.startsWith("/api/v1/fs/copy"));
  assert.match(String((copy?.body as { toPath: string }).toPath), /^\/aioa\/\d{4}-\d{2}$/);
});
