import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCode, parseMailInput, vendorOf } from "@hx-aioa/protocol";
import { parseRaw } from "../src/mail/email";

const INBOX = "aioa@example.org";

test("厂商: 子域名归到主厂商, 不认识的用主域名", () => {
  assert.equal(vendorOf("noreply@tm.openai.com"), "GPT");
  assert.equal(vendorOf("GitHub <noreply@github.com>"), "GitHub");
  assert.equal(vendorOf("a@mail.shop.example.co"), "example.co");
});

test("验证码: 有提示词才取, 优先纯数字", () => {
  assert.equal(extractCode("Your verification code", "Code: 482913"), "482913");
  assert.equal(extractCode("你的验证码", "本次验证码为 AB12CD, 5 分钟内有效"), "AB12CD");
  assert.equal(extractCode("周报", "本周新增 123456 行"), undefined);
});

test("推送格式校验", () => {
  assert.equal(parseMailInput({ from: "a@b.c" }).ok, false);
  assert.equal(parseMailInput({ from: "a@b.c", to: INBOX }).ok, false);
  assert.equal(parseMailInput({ from: "a@b.c", to: INBOX, subject: "hi" }).ok, true);
});

const raw = (headers: string, body: string) => new TextEncoder().encode(`${headers}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`).buffer;

test("解析原始邮件: 直投用投递地址, Gmail 转发用原收件地址", async () => {
  const direct = await parseRaw(raw(`From: GitHub <noreply@github.com>\r\nTo: ${INBOX}\r\nSubject: =?UTF-8?B?5rWL6K+V?=\r\nMessage-ID: <x1@github.com>\r\nDate: Mon, 23 Nov 2026 10:00:00 +0000`, "hello"), "bounce@github.com", INBOX);
  assert.equal(direct.from, "noreply@github.com");
  assert.equal(direct.name, "GitHub");
  assert.equal(direct.to, INBOX);
  assert.equal(direct.subject, "测试");
  assert.equal(direct.messageId, "<x1@github.com>");
  assert.equal(direct.ts, Date.UTC(2026, 10, 23, 10));
  const fwd = await parseRaw(raw(`From: noreply@tm.openai.com\r\nTo: me@gmail.com\r\nX-Forwarded-For: me@gmail.com ${INBOX}\r\nSubject: code`, "Code: 112233"), "x@gmail.com", INBOX);
  assert.equal(fwd.to, "me@gmail.com");
  const outlook = await parseRaw(raw(`From: a@b.com\r\nTo: me@outlook.com\r\nSubject: s`, "t"), "x@outlook.com", INBOX);
  assert.equal(outlook.to, "me@outlook.com");
});
