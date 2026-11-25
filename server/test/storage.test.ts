import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { FILES_TOTAL_MAX_BYTES, STORAGE_DEFAULTS, type StorageSettings } from "@hx-aioa/protocol";
import type { Env } from "../src/env";
import { fileData } from "../src/files/data";
import type { Drive } from "../src/files/drive";
import { checkStorage, storageOf } from "../src/files/storage";
import { FileStore } from "../src/files/store";
import { ticketPath } from "../src/files/ticket";

// Workers 才有 timingSafeEqual 与 FixedLengthStream, 测试里补上
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
subtle.timingSafeEqual ??= (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
const g = globalThis as unknown as { FixedLengthStream?: unknown };
g.FixedLengthStream ??= class {
  readonly readable: ReadableStream;
  readonly writable: WritableStream;
  constructor() {
    const t = new TransformStream();
    this.readable = t.readable;
    this.writable = t.writable;
  }
};

// Node 的 fetch 发流式请求体要 duplex: "half", Workers 不需要; 测试里统一补上
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init?.body ? ({ duplex: "half", ...init } as RequestInit) : init);
  }
} as typeof Request;

const MB = 1024 * 1024;
const ORIGIN = "https://aioa.example";
const DRIVE_ORIGIN = "https://drive.example";

/** 用 node:sqlite 模拟 DO 的 SqlStorage: 有结果列的语句返回行, 其余返回写入行数。 */
function sqlStorage(db = new DatabaseSync(":memory:")): SqlStorage {
  return {
    exec(q: string, ...b: unknown[]) {
      const st = db.prepare(q);
      if (st.columns().length) {
        const rows = st.all(...(b as never[]));
        return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 };
      }
      const r = st.run(...(b as never[]));
      return { toArray: () => [], one: () => undefined, rowsWritten: Number(r.changes) };
    },
  } as unknown as SqlStorage;
}

function fakeDrive(fail = false) {
  const calls = { remove: [] as string[], link: 0 };
  const drive = {
    async remove(id: string) {
      calls.remove.push(id);
      if (fail) throw new Error("drive down");
    },
    async link(id: string) {
      calls.link++;
      return `${DRIVE_ORIGIN}/f/${id}?sig=${calls.link}`;
    },
  } as unknown as Drive;
  return { drive, calls };
}

const bucket = { deleted: [] as string[], async delete(ids: string | string[]) { this.deleted.push(...([] as string[]).concat(ids)); } };
const s = (over: Partial<StorageSettings> = {}): StorageSettings => ({ ...STORAGE_DEFAULTS, ...over });

test("老库升级: 补 store / ext 两列, 已有文件记为 r2", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE file (id TEXT PRIMARY KEY, grp TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, by TEXT NOT NULL, created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, refs INTEGER NOT NULL DEFAULT 0)");
  db.exec("INSERT INTO file VALUES ('f_old', 'g', 'a.txt', 3, 'text/plain', 'owner', 1, 1, 1)");
  const files = new FileStore(sqlStorage(db), bucket as unknown as R2Bucket, undefined);
  assert.equal(files.row("f_old")?.store, "r2");
  assert.equal(files.row("f_old")?.ext, null);
});

test("路由: 按阈值选后端, off 拒收, 没绑的后端 503", () => {
  const { drive } = fakeDrive();
  const files = new FileStore(sqlStorage(), bucket as unknown as R2Bucket, drive);
  const route = s({ large: "cfd" });
  assert.equal(files.pick(5 * MB, route), "r2");
  assert.equal(files.pick(21 * MB, route), "cfd");
  assert.deepEqual(files.pick(21 * MB, s({ large: "off" }))[0], 413);
  const noDrive = new FileStore(sqlStorage(), bucket as unknown as R2Bucket, undefined);
  assert.equal(noDrive.pick(21 * MB, route)[0], 503);
  // 默认配置与接入前一样: 大文件也走 R2
  assert.equal(noDrive.pick(21 * MB, STORAGE_DEFAULTS), "r2");
});

test("R2 满了: 默认拒收, 主人选了 onFull=cfd 才改走 Drive", () => {
  const { drive } = fakeDrive();
  const files = new FileStore(sqlStorage(), bucket as unknown as R2Bucket, drive);
  const big = files.create("g", "big", FILES_TOTAL_MAX_BYTES - MB, "a/b", "owner", "r2");
  files.done(big.id, FILES_TOTAL_MAX_BYTES - MB);
  assert.equal(files.pick(2 * MB, s())[0], 507);
  assert.equal(files.pick(2 * MB, s({ onFull: "cfd" })), "cfd");
  // Drive 里的字节不算进 R2 上限
  const u = files.usage(s());
  assert.equal(u.byStore.r2.bytes, FILES_TOTAL_MAX_BYTES - MB);
  assert.equal(u.byStore.cfd.count, 0);
  assert.deepEqual(u.ready, { r2: true, cfd: true });
});

test("cfd 文件: 换地址缓存 Drive 直链, 删除当场删 Drive, R2 文件仍走桶", async () => {
  const { drive, calls } = fakeDrive();
  const files = new FileStore(sqlStorage(), bucket as unknown as R2Bucket, drive);
  const a = files.create("g", "a.bin", 30 * MB, "a/b", "owner", "cfd");
  files.done(a.id, 30 * MB, "n_1");
  const row = files.row(a.id);
  assert.ok(row);
  const l1 = await files.driveLink(row);
  const l2 = await files.driveLink(row);
  assert.equal(calls.link, 1);
  assert.equal(l1?.url, l2?.url);
  assert.ok(l1?.url.startsWith(DRIVE_ORIGIN));
  const b = files.create("g", "b.txt", 3, "text/plain", "owner", "r2");
  files.done(b.id, 3);
  assert.equal(await files.dropGroup("g"), 2);
  assert.deepEqual(calls.remove, ["n_1"]);
  assert.ok(bucket.deleted.includes(b.id));
  assert.equal(files.row(a.id), null);
});

test("Drive 删除失败: 行保留成未完成无引用, 发不出去, 下次 sweep 重试", async () => {
  const bad = fakeDrive(true);
  const sql = sqlStorage();
  const files = new FileStore(sql, bucket as unknown as R2Bucket, bad.drive);
  const a = files.create("g", "a.bin", 30 * MB, "a/b", "owner", "cfd");
  files.done(a.id, 30 * MB, "n_2");
  await files.remove(a.id);
  const left = files.row(a.id);
  assert.equal(left?.done, 0);
  assert.equal(left?.refs, 0);
  assert.equal(files.ref(a.id), null);
  const good = fakeDrive();
  const again = new FileStore(sql, bucket as unknown as R2Bucket, good.drive);
  assert.equal(await again.sweep(), 1);
  assert.deepEqual(good.calls.remove, ["n_2"]);
  assert.equal(again.row(a.id), null);
});

test("迁移候选: 冷迁移按最近下载时间, 换地址一天只记一次, 搬回 R2 只要 95 MB 以内", () => {
  const { drive } = fakeDrive();
  const files = new FileStore(sqlStorage(), bucket as unknown as R2Bucket, drive);
  const DAY = 24 * 3600_000;
  const now = Date.UTC(2026, 10, 25);
  const old = files.create("g", "old.bin", 10, "a/b", "owner", "r2", now - 100 * DAY);
  const fresh = files.create("g", "fresh.bin", 10, "a/b", "owner", "r2", now - 100 * DAY);
  const big = files.create("g", "big.bin", 200 * MB, "a/b", "owner", "cfd", now);
  for (const f of [old, fresh]) files.done(f.id, 10);
  files.done(big.id, 200 * MB, "n_big");
  files.touch(fresh.id, now - 10 * DAY);
  files.touch(fresh.id, now - 10 * DAY + 1000);
  assert.equal(files.row(fresh.id)?.last_dl, now - 10 * DAY);
  assert.deepEqual(files.candidates("cfd", 90, [], 10, now).rows.map((r) => r.id), [old.id]);
  assert.equal(files.candidates("cfd", 0, [], 10, now).total, 2);
  assert.equal(files.candidates("cfd", 0, [old.id], 10, now).total, 1);
  assert.equal(files.candidates("r2", 0, [], 10, now).total, 0);
  assert.equal(files.tooBigForR2(), 1);
});

test("存储设置校验: 合并缺省键, 拒绝没绑定的后端与非法值", () => {
  const all = () => true;
  const r2only = (k: string) => k === "r2";
  assert.deepEqual(checkStorage({ large: "cfd" }, STORAGE_DEFAULTS, all), { ...STORAGE_DEFAULTS, large: "cfd" });
  assert.match(checkStorage({ large: "cfd" }, STORAGE_DEFAULTS, r2only) as string, /HX-CF-Drive/);
  assert.match(checkStorage({ direct: true }, STORAGE_DEFAULTS, r2only) as string, /HX-CF-Drive/);
  assert.match(checkStorage({ threshold: 10 }, STORAGE_DEFAULTS, all) as string, /threshold/);
  assert.match(checkStorage({ small: "s3" }, STORAGE_DEFAULTS, all) as string, /small/);
  assert.match(checkStorage({ foo: 1 }, STORAGE_DEFAULTS, all) as string, /foo/);
  assert.deepEqual(storageOf({}), STORAGE_DEFAULTS);
  assert.equal(storageOf({ storage: { large: "off" } }).large, "off");
  assert.match(checkStorage({ coldDays: 90 }, STORAGE_DEFAULTS, r2only) as string, /HX-CF-Drive/);
  assert.match(checkStorage({ coldDays: -1 }, STORAGE_DEFAULTS, all) as string, /coldDays/);
  assert.equal((checkStorage({ coldDays: 90 }, STORAGE_DEFAULTS, all) as StorageSettings).coldDays, 90);
});

/** Worker 侧: Drive 的 Service Binding 与 Hub 都是假的, 记下收到的请求。 */
function driveEnv() {
  const seen: { url: string; auth: string | null; len: string | null; type: string | null; body: string }[] = [];
  const done: unknown[][] = [];
  const DRIVE = {
    async fetch(req: Request) {
      seen.push({ url: req.url, auth: req.headers.get("authorization"), len: req.headers.get("content-length"), type: req.headers.get("content-type"), body: await req.text() });
      return Response.json({ success: true, data: { node: { id: "n_9", size: 5 } } });
    },
  };
  const hub = { fileDone: async (...a: unknown[]) => (done.push(a), true) };
  const env = { TOKEN_SECRET: "k", AUTH_TOKEN: "k", DRIVE, CFD_ORIGIN: `${DRIVE_ORIGIN}/`, CFD_TOKEN: "cfd-tok", HUB: { idFromName: () => "x", get: () => hub } } as unknown as Env;
  return { env, seen, done };
}

async function put(env: Env, path: string, body = "hello"): Promise<Response> {
  const url = new URL(path, ORIGIN);
  const req = new Request(url, { method: "PUT", body, headers: { "content-length": String(body.length), "content-type": "text/plain" }, duplex: "half" } as RequestInit);
  return (await fileData(req, env, url)) as Response;
}

test("登记到 Drive 的文件: Worker 把字节转给 Drive 并回报节点 id (没绑 R2 也能传)", async () => {
  const { env, seen, done } = driveEnv();
  const path = `${await ticketPath(env, "up", "f_1", Date.now() + 60_000, 5, "cfd")}&n=${encodeURIComponent("报告.txt")}`;
  const res = await put(env, path);
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  const u = new URL(seen[0]?.url ?? "");
  assert.equal(u.origin + u.pathname, `${DRIVE_ORIGIN}/api/v1/upload`);
  assert.equal(u.searchParams.get("name"), "f_1_报告.txt");
  assert.match(u.searchParams.get("path") ?? "", /^\/\d{4}-\d{2}$/);
  assert.equal(seen[0]?.auth, "Bearer cfd-tok");
  assert.equal(seen[0]?.len, "5");
  assert.equal(seen[0]?.body, "hello");
  assert.deepEqual(done[0], ["f_1", 5, "n_9"]);
});

test("票据里的后端改不了: R2 票据加 b=cfd 无效", async () => {
  const { env, seen } = driveEnv();
  const path = await ticketPath(env, "up", "f_2", Date.now() + 60_000, 5);
  const res = await put(env, `${path}&b=cfd`);
  assert.equal(res.status, 403);
  assert.equal(seen.length, 0);
});

test("没接 Drive 时 cfd 票据上传 503, 不改写 R2", async () => {
  const { env } = driveEnv();
  const path = await ticketPath(env, "up", "f_3", Date.now() + 60_000, 5, "cfd");
  const noDrive = { ...env, DRIVE: undefined } as unknown as Env;
  assert.equal((await put(noDrive, path)).status, 503);
});
