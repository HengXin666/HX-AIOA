import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "../src/env";

const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
subtle.timingSafeEqual ??= (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

// 假的 caches.default: 只按 URL 存取, 记下调用次数
const store = new Map<string, string>();
let cacheCalls = 0;
(globalThis as Record<string, unknown>).caches = {
  default: {
    async match(url: string) {
      cacheCalls++;
      const v = store.get(url);
      return v === undefined ? undefined : new Response(v);
    },
    async put(url: string, res: Response) {
      cacheCalls++;
      store.set(url, await res.text());
    },
  },
};

const { HEADER_DRIVE_PASS } = await import("@hx-aioa/protocol");
const { driveWorker } = await import("../src/drive/worker");
const { signPass } = await import("../src/drive/pass");
const { DRIVE_ROUTES } = await import("../src/drive/api");

const BASE = "https://aioa.example";

/** 假 Drive: 记下每个请求的路径; 列表内容由 names 决定。 */
function envOf(calls: string[], names: string[], origin: string): Env {
  const drive = {
    async fetch(req: Request): Promise<Response> {
      const u = new URL(req.url);
      const p = u.pathname.replace("/api/v1", "");
      calls.push(p);
      if (p === "/fs/stat") return Response.json({ node: { id: "root" }, path: req.headers.get("x-drive-scope") ? "/drive" : "/" });
      if (p === "/fs/list") return Response.json({ node: { id: "d", kind: "dir" }, children: names.map((n) => ({ id: n, name: n, kind: "file", size: 1 })) });
      if (p === "/admin/stats") return Response.json({ nodes: [{ kind: "file", n: 2 }], blobs: { n: 2, bytes: 9 } });
      return Response.json({ ok: true });
    },
  };
  return { TOKEN_SECRET: "k", AUTH_TOKEN: "owner-token", CFD_ORIGIN: origin, CFD_DRIVE_TOKEN: "hxd_whole", DRIVE: drive } as unknown as Env;
}

async function call(env: Env, method: string, path: string, uid = "u_owner", body?: unknown) {
  const url = new URL(path, BASE);
  const headers = { [HEADER_DRIVE_PASS]: (await signPass(env, uid)).pass };
  return (await driveWorker(new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, url))!;
}

test("列表命中边缘缓存时不碰 Drive; 写操作后版本号换新, 下一次读到新内容 (#159)", async () => {
  const calls: string[] = [];
  const names = ["a.txt"];
  const env = envOf(calls, names, "https://c1.example");
  const first = await call(env, "GET", "/api/v1/drive/list?path=/docs");
  assert.equal(first.headers.get("x-aioa-cache"), "miss");
  assert.ok(calls.includes("/fs/list"));
  calls.length = 0;
  cacheCalls = 0;
  const second = await call(env, "GET", "/api/v1/drive/list?path=/docs");
  assert.equal(second.headers.get("x-aioa-cache"), "hit");
  assert.deepEqual(calls, []);
  assert.ok(cacheCalls <= 2);
  assert.equal(second.headers.get("etag"), first.headers.get("etag"));
  const nm = await call(env, "GET", "/api/v1/drive/list?path=/docs");
  assert.equal((await driveWorker(new Request(new URL("/api/v1/drive/list?path=/docs", BASE), { headers: { [HEADER_DRIVE_PASS]: (await signPass(env, "u_owner")).pass, "if-none-match": nm.headers.get("etag")! } }), env, new URL("/api/v1/drive/list?path=/docs", BASE)))?.status, 304);
  assert.deepEqual(calls, []);

  names.push("b.txt");
  assert.equal((await call(env, "POST", "/api/v1/drive/mkdir", "u_owner", { path: "/docs/新" })).status, 200);
  calls.length = 0;
  const after = await call(env, "GET", "/api/v1/drive/list?path=/docs");
  assert.equal(after.headers.get("x-aioa-cache"), "miss");
  assert.equal((await after.json<{ items: unknown[] }>()).items.length, 2);
  assert.ok(calls.includes("/fs/list"));
});

test("缓存按主人分开, 写操作让同一网盘所有视角失效; fresh=1 绕过缓存", async () => {
  const calls: string[] = [];
  const env = envOf(calls, ["a"], "https://c2.example");
  await call(env, "GET", "/api/v1/drive/list?path=/", "u_a");
  calls.length = 0;
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/", "u_b")).headers.get("x-aioa-cache"), "miss");
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/", "u_a")).headers.get("x-aioa-cache"), "hit");
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/&fresh=1", "u_a")).headers.get("x-aioa-cache"), "miss");
  await call(env, "POST", "/api/v1/drive/delete", "u_b", { id: "a" });
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/", "u_a")).headers.get("x-aioa-cache"), "miss");
});

test("首页一次请求: stats=1 顺带用量, 也走缓存", async () => {
  const calls: string[] = [];
  const env = envOf(calls, ["a"], "https://c3.example");
  const r = await (await call(env, "GET", "/api/v1/drive/list?path=/&stats=1")).json<{ items: unknown[]; stats: { files: number; bytes: number } }>();
  assert.deepEqual([r.items.length, r.stats.files, r.stats.bytes], [1, 2, 9]);
  calls.length = 0;
  const again = await call(env, "GET", "/api/v1/drive/list?path=/&stats=1");
  assert.equal(again.headers.get("x-aioa-cache"), "hit");
  assert.deepEqual(calls, []);
  const plain = await (await call(env, "GET", "/api/v1/drive/list?path=/")).json<Record<string, unknown>>();
  assert.equal("stats" in plain, false);
});

test("主 Hub 存到网盘后也让列表缓存失效", async () => {
  const calls: string[] = [];
  const env = envOf(calls, ["a"], "https://c4.example");
  await call(env, "GET", "/api/v1/drive/list?path=/聊天文件");
  const owner = { owner: true, user: { id: "u_owner", role: "owner" } };
  const files = { row: () => ({ id: "f_1", done: true, store: "cfd", ext: "n_att", name: "a.txt" }) };
  const save = DRIVE_ROUTES.find((r) => r.re.test("/api/v1/drive/save"))!;
  const fake = (env as unknown as { DRIVE: { fetch: (r: Request) => Promise<Response> } }).DRIVE;
  const orig = fake.fetch.bind(fake);
  fake.fetch = async (req) => (new URL(req.url).pathname.endsWith("/fs/copy") ? Response.json({ node: { id: "c1", name: "a.txt", kind: "file", size: 1 } }) : orig(req));
  const url = new URL("/api/v1/drive/save", BASE);
  const c = { req: new Request(url, { method: "POST", body: JSON.stringify({ file: "f_1" }) }), url, params: [], who: owner, core: { env, files } } as never;
  assert.equal((await save.handler(c)).status, 200);
  assert.equal((await call(env, "GET", "/api/v1/drive/list?path=/聊天文件")).headers.get("x-aioa-cache"), "miss");
});
