import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { digestMail, extractCode, mailText, type MailDigest } from "@hx-aioa/protocol";

// 快照: protocol/fixtures/mail 下的去敏样例, 安卓 MailDigestTest 读同一份; UPDATE_SNAPSHOTS=1 重新生成
const DIR = new URL("../../protocol/fixtures/mail/", import.meta.url);
const SNAP = new URL("snapshots.json", DIR);
const TS = 1795824000000;
type Case = { name: string; subject: string; from: string; sender?: string };

const read = (name: string) => (existsSync(new URL(name, DIR)) ? readFileSync(new URL(name, DIR), "utf8") : undefined);
const cases = JSON.parse(read("cases.json")!) as Case[];
const digest = (c: Case): MailDigest =>
  digestMail({ subject: c.subject, from: c.from, name: c.sender, html: read(`${c.name}.html`), text: read(`${c.name}.txt`), ts: TS });

test("精简正文快照: 各类样例与快照一致", () => {
  const got = Object.fromEntries(cases.map((c) => [c.name, digest(c)]));
  if (process.env.UPDATE_SNAPSHOTS) writeFileSync(SNAP, `${JSON.stringify(got, null, 2)}\n`);
  assert.deepEqual(got, JSON.parse(readFileSync(SNAP, "utf8")));
});

test("验证码: 中英文, 空格分组, 字母数字, 有效期", () => {
  const by = Object.fromEntries(cases.map((c) => [c.name, digest(c)]));
  assert.deepEqual(by["otp-zh"]?.otp, { code: "385172", expiresAt: TS + 10 * 60_000 });
  assert.deepEqual(by["otp-en"]?.otp, { code: "482913", expiresAt: TS + 15 * 60_000 });
  assert.equal(by["otp-alnum"]?.otp?.code, "K7Q2ZP");
  assert.equal(by["otp-en"]?.links[0]?.url.startsWith("https://auth.example.com/"), true);
  assert.equal(by["otp-zh"]?.brief, "");
});

test("不是验证码: GitHub 通知里的数字, 营销信的 no code, 引用里的旧码", () => {
  const by = Object.fromEntries(cases.map((c) => [c.name, digest(c)]));
  for (const n of ["github-comment", "github-run", "github-dependabot", "marketing-sale", "reply-zh", "bill-zh"]) assert.equal(by[n]?.otp, undefined, n);
  assert.equal(extractCode("Re: [a/b] release", "规则统计: code-path: 2\n其余 1488 项见附件"), undefined);
});

test("去噪: 引用历史, 签名, 页脚, 隐藏预览文字, 追踪像素", () => {
  const by = Object.fromEntries(cases.map((c) => [c.name, digest(c)]));
  assert.equal(by["reply-en"]?.body.includes("wrote"), false);
  assert.equal(by["reply-zh"]?.body, "好的, 周五上线, 我今晚把发布说明更新一下。");
  assert.equal(by["outlook-reply"]?.body.includes("发件人"), false);
  assert.equal(by["github-comment"]?.body.includes("unsubscribe"), false);
  assert.equal(by["otp-zh"]?.body.includes("请查收验证码"), false);
  assert.equal(mailText("<p>a<span style=\"display:none\">x<span>y</span>z</span>b</p>", undefined).text, "ab");
  assert.equal(mailText("<pre>第一行\r\n\r\n  第二行</pre>", undefined).text, "第一行\n第二行");
});

test("分类: GitHub, 账单, 物流, 营销, 状态告警不算营销", () => {
  const by = Object.fromEntries(cases.map((c) => [c.name, digest(c)]));
  assert.equal(by["github-run"]?.kind, "github");
  assert.deepEqual(by["github-run"]?.facts, [{ label: "仓库", value: "octo-user/flows-repo" }]);
  assert.equal(by["bill-zh"]?.facts[0]?.value, "¥128.50");
  assert.equal(by["shipping-zh"]?.facts[0]?.value, "SF1234567890123");
  assert.equal(by["marketing-sale"]?.kind, "marketing");
  assert.equal(by["status-alert"]?.kind, "normal");
});
