import assert from "node:assert/strict";
import { test } from "node:test";
import { MAIL_PREFS_DEFAULT, extractCode, imagesAllowed, parseMailPrefs, parseMailRules, ruleMatches, styleOf, type MailInfo } from "@hx-aioa/protocol";

test("验证码: 资讯信里的年份和远处的数字不算", () => {
  assert.equal(extractCode("Where good hackathon ideas come from", "Newsletter Nov 24, 2026. Write code, win 25000 dollars"), undefined);
  assert.equal(extractCode("登录提醒", "123456 是你的验证码"), "123456");
  assert.equal(extractCode("Sign in", "Use code 2026 to log in"), undefined);
  assert.equal(extractCode("Sign in", "Your one-time passcode is 739204."), "739204");
});

test("远程图片: 白名单默认放行, 其余拦截, 发件人设置优先", () => {
  const p = MAIL_PREFS_DEFAULT;
  assert.equal(imagesAllowed(p, "noreply@github.com"), true);
  assert.equal(imagesAllowed(p, "darlyze@devpost.com"), false);
  assert.equal(imagesAllowed(p, "noreply@github.com", true), false);
  const q = { images: "known" as const, senders: { "devpost.com": { images: "show" as const }, "x@github.com": { images: "block" as const, style: "original" as const } } };
  assert.equal(imagesAllowed(q, "darlyze@news.devpost.com"), true);
  assert.equal(imagesAllowed(q, "x@github.com"), false);
  assert.equal(styleOf(q, "x@github.com"), "original");
  assert.equal(styleOf(q, "y@github.com"), "adapt");
  assert.equal(imagesAllowed({ images: "all", senders: {} }, "a@b.example"), true);
  assert.equal(imagesAllowed({ images: "none", senders: {} }, "noreply@github.com"), false);
});

test("偏好校验", () => {
  assert.equal(typeof parseMailPrefs({ images: "maybe" }), "string");
  const ok = parseMailPrefs({ images: "all", senders: { "A@B.com": { images: "show", style: "bad" }, "c.com": {} } });
  assert.deepEqual(ok, { images: "all", senders: { "a@b.com": { images: "show" } } });
});

test("转发规则: 条件全满足才命中, 关闭的不算", () => {
  const mail: MailInfo = { from: "notifications@github.com", to: "loli@woa.qzz.io", vendor: "GitHub", category: "开发", via: "cf" };
  const rules = parseMailRules({ rules: [{ channel: "dev", domain: "github.com", subject: "run failed" }, { channel: "x", from: "a@b.com", on: false }] });
  assert.ok(Array.isArray(rules));
  const [r1, r2] = rules as Exclude<typeof rules, string>;
  assert.equal(ruleMatches(r1!, mail, "[HX] Run failed: deploy"), true);
  assert.equal(ruleMatches(r1!, mail, "[HX] PR merged"), false);
  assert.equal(ruleMatches(r2!, { ...mail, from: "a@b.com" }, "x"), false);
  assert.equal(r1!.keep, true);
  assert.equal(typeof parseMailRules({ rules: [{ channel: "dev" }] }), "string");
});
