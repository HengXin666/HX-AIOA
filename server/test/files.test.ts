import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "../src/env";
import { fileData } from "../src/files/data";
import { ticketPath } from "../src/files/ticket";

// Workers 才有 timingSafeEqual, 测试里补一个
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
subtle.timingSafeEqual ??= (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

const ORIGIN = "https://aioa.example";

/** 只实现下载要用到的 R2 接口, put 记下写入的 Content-Type */
function fakeEnv(mime: string) {
  const puts: (string | undefined)[] = [];
  const bucket = {
    async get() {
      return {
        size: 4,
        httpEtag: '"e"',
        body: new Blob(["<b>"]).stream(),
        writeHttpMetadata: (h: Headers) => h.set("content-type", mime),
      };
    },
    async put(_id: string, _body: unknown, opt?: { httpMetadata?: { contentType?: string } }) {
      puts.push(opt?.httpMetadata?.contentType);
      return { size: 4 };
    },
  };
  const hub = { fileDone: async () => true };
  const env = { TOKEN_SECRET: "k", AUTH_TOKEN: "k", FILES: bucket, HUB: { idFromName: () => "x", get: () => hub } } as unknown as Env;
  return { env, puts };
}

async function get(env: Env): Promise<Response> {
  const path = await ticketPath(env, "dl", "f_1", Date.now() + 60_000, 0);
  const url = new URL(path, ORIGIN);
  return (await fileData(new Request(url), env, url)) as Response;
}

test("下载: html 在沙箱里返回, 带 nosniff", async () => {
  const r = await get(fakeEnv("text/html").env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy") ?? "", /^sandbox;/);
});

test("下载: PDF 不带 sandbox, 以便浏览器内置查看器打开", async () => {
  const r = await get(fakeEnv("application/pdf").env);
  assert.equal(r.headers.get("content-security-policy"), null);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("上传: 非法 Content-Type 不写进 R2", async () => {
  const { env, puts } = fakeEnv("image/png");
  for (const type of ["image/PNG", "text/html; x=<b>", ""]) {
    const path = await ticketPath(env, "up", "f_1", Date.now() + 60_000, 4);
    const url = new URL(path, ORIGIN);
    const req = new Request(url, { method: "PUT", body: new Uint8Array([1, 2, 3, 4]), headers: type ? { "content-type": type, "content-length": "4" } : { "content-length": "4" } });
    await fileData(req, env, url);
  }
  assert.deepEqual(puts, ["image/png", undefined, undefined]);
});
