import assert from "node:assert/strict";
import { test } from "node:test";
import { TERM_MAX_DATA, TERM_TICKET_MS, parseClientFrame } from "@hx-aioa/protocol";
import { Terminals } from "../src/terminal";

// Workers 才有 timingSafeEqual, 测试里补一个
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
subtle.timingSafeEqual ??= (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

const terms = (secret = "secret") => new Terminals(() => [], () => secret, async () => {});

test("终端票据: 主体, 过期, 篡改, 换密钥都会被拒", async () => {
  const t = terms();
  const now = 1_000_000;
  const { ticket } = await t.ticket("nas", now);
  assert.equal(await t.verify(ticket, "nas", now + 1), true);
  assert.equal(await t.verify(ticket, "other", now + 1), false);
  assert.equal(await t.verify(ticket, "nas", now + TERM_TICKET_MS + 1), false);
  assert.equal(await t.verify(ticket.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "nas", now + 1), false);
  assert.equal(await terms("another").verify(ticket, "nas", now + 1), false);
});

test("终端帧解析: 尺寸与数据长度有上限", () => {
  const open = { t: "term_open", sid: "a", subject: "nas", ticket: "x", cols: 80, rows: 24 };
  assert.deepEqual(parseClientFrame(JSON.stringify(open)), open);
  assert.equal(parseClientFrame(JSON.stringify({ ...open, cols: 0 })), null);
  assert.equal(parseClientFrame(JSON.stringify({ t: "term", sid: "a", d: "x".repeat(TERM_MAX_DATA + 1) })), null);
  assert.equal(parseClientFrame(JSON.stringify({ t: "term", d: "eA==" })), null);
  assert.deepEqual(parseClientFrame(JSON.stringify({ t: "host", subject: "s", info: { shell: true, os: "x" } })), { t: "host", subject: "s", info: { os: "x", shell: true } });
});
