import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTranslateInput, skipSegment } from "@hx-aioa/protocol";
import { azureTranslate } from "../src/translate/azure";
import type { Env } from "../src/env";

test("跳过不用翻的段: 中文, 数字, 链接, 空白", () => {
  assert.equal(skipSegment("你的验证码是 <b>482913</b>"), true);
  assert.equal(skipSegment("482913"), true);
  assert.equal(skipSegment(" https://github.com/x/y "), true);
  assert.equal(skipSegment("noreply@github.com"), true);
  assert.equal(skipSegment("<br> &nbsp; "), true);
  assert.equal(skipSegment("Your <b>order</b> has shipped."), false);
  assert.equal(skipSegment("ご注文ありがとうございます"), false);
  assert.equal(skipSegment("GitHub 发来的 Pull request merged into main"), false);
});

test("参数校验", () => {
  assert.equal(typeof parseTranslateInput({}), "string");
  assert.equal(typeof parseTranslateInput({ texts: [1] }), "string");
  assert.equal(typeof parseTranslateInput({ texts: ["a"], format: "md" }), "string");
  assert.equal(typeof parseTranslateInput({ texts: ["a"], to: "zh hans" }), "string");
  assert.deepEqual(parseTranslateInput({ texts: ["a"], to: "zh-Hans", format: "html" }), { texts: ["a"], to: "zh-Hans", format: "html" });
});

test("微软接口: 请求格式与返回解析", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify([{ detectedLanguage: { language: "en" }, translations: [{ text: "您的<b>订单</b>已发货。", to: "zh-Hans" }] }]));
  }) as unknown as typeof fetch;
  const env = { AZURE_TRANSLATOR_KEY: "k", AZURE_TRANSLATOR_REGION: "eastasia" } as Env;
  const out = await azureTranslate(env, ["Your <b>order</b> has shipped."], "zh-Hans", "html", fake);
  assert.deepEqual(out, [{ text: "您的<b>订单</b>已发货。", from: "en" }]);
  assert.match(seen!.url, /textType=html/);
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h["Ocp-Apim-Subscription-Region"], "eastasia");
  const bad = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(azureTranslate(env, ["x"], "zh-Hans", "text", bad), /密钥/);
});
