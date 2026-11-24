import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryOf, extractCode, isRelayAddress, parseMailInput, siteOf, vendorOf } from "@hx-aioa/protocol";
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

test("收件账号: 路由直投用投递地址, 仓库 noreply 只记为经由", async () => {
  const gh = `From: Heng_Xin <notifications@github.com>\r\nTo: HengXin666/HX-UI <HX-UI@noreply.github.com>\r\nCc: Heng_Xin <me@woa.qzz.io>, Author <author@noreply.github.com>\r\nSubject: Run failed`;
  const routed = await parseRaw(raw(gh, "t"), "bounce@github.com", "me@woa.qzz.io");
  assert.equal(routed.to, "me@woa.qzz.io");
  assert.equal(routed.list, "hx-ui@noreply.github.com");
  // 投到 AIOA 入口: 不用 To 里的 noreply, 用 Cc 里的真实地址
  const viaEntry = await parseRaw(raw(gh, "t"), "bounce@github.com", INBOX);
  assert.equal(viaEntry.to, "me@woa.qzz.io");
  assert.equal(viaEntry.rcpt, INBOX);
  const orig = await parseRaw(raw(`From: a@b.com\r\nX-Original-To: you@woa.qzz.io\r\nTo: list@noreply.example.com\r\nSubject: s`, "t"), "x@b.com", INBOX);
  assert.equal(orig.to, "you@woa.qzz.io");
});

test("中转地址与主域名", () => {
  for (const a of ["hx-ui@noreply.github.com", "noreply@github.com", "notifications@github.com", "reply+abc@reply.github.com", "do-not-reply@x.com"]) assert.ok(isRelayAddress(a), a);
  for (const a of ["me@woa.qzz.io", "loli@qq.com", "support@devpost.com"]) assert.ok(!isRelayAddress(a), a);
  assert.equal(siteOf("noreply@mail.notion.so"), "notion.so");
  assert.equal(siteOf("a@service.taobao.com.cn"), "taobao.com.cn");
});

test("冒充判断: 只信 CF 最上面那条, 经可信转发看上一跳", async () => {
  const cf = (v: string) => `ARC-Authentication-Results: i=2; mx.cloudflare.net; ${v}`;
  const base = `From: a@bank.com\r\nTo: ${INBOX}\r\nSubject: s`;
  const parse = (h: string) => parseRaw(raw(`${h}\r\n${base}`, "t"), "x@y.z", INBOX);
  assert.equal((await parse(cf("dkim=pass; spf=pass; dmarc=pass"))).spoof, undefined);
  assert.equal((await parse(cf("spf=fail; dmarc=fail"))).spoof, true);
  // 伪造的通过头在 CF 那条下面, 不算数
  assert.equal((await parse(`${cf("dmarc=fail")}\r\nAuthentication-Results: mx.google.com; dmarc=pass`)).spoof, true);
  // Gmail 转发: CF 看到 SPF 失败, 但 ARC 链有效且 Gmail 那跳通过
  assert.equal((await parse(`${cf("arc=pass; dmarc=fail")}\r\nARC-Authentication-Results: i=1; mx.google.com; dmarc=pass`)).spoof, undefined);
  assert.equal((await parse("Authentication-Results: x; dmarc=fail")).spoof, undefined);
});

test("分类: 厂商表优先, 不认识的按域名关键词猜", () => {
  assert.equal(categoryOf("noreply@tm.openai.com"), "AI");
  assert.equal(categoryOf("noreply@github.com"), "开发");
  assert.equal(categoryOf("x@aws.amazon.com"), "云服务");
  assert.equal(categoryOf("x@amazon.com"), "购物");
  assert.equal(categoryOf("info@mybank.com"), "其他");
  assert.equal(categoryOf("info@bank-of-x.com"), "金融");
  assert.equal(categoryOf("hi@mail.tsinghua.edu.cn"), "教育");
  assert.equal(categoryOf("hi@display.com"), "其他");
  assert.equal(categoryOf("bot@foo.ai"), "AI");
  assert.equal(categoryOf("random@example.org"), "其他");
});
