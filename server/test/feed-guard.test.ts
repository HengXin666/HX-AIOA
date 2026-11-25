import assert from "node:assert/strict";
import { test } from "node:test";
import { feedGuard, CODE_FEED_REQUIRED } from "../src/feed-guard";

const FEED_GROUP = { channel: "福利羊毛", title: "福利羊毛", view: "feed" } as never;
const ITEM = { title: "x", kind: "deal" };

test("feed-guard: 普通群不管", () => {
  assert.equal(feedGuard({ channel: "a" } as never, { html: "<div>x</div>" }, false), null);
});

test("feed-guard: 信息流群 Agent 发 HTML 被拒, 错误里带 feed 写法和可用标签", () => {
  const r = feedGuard(FEED_GROUP, { title: "快报", html: "<div>x</div>" }, false);
  assert.equal(r?.status, 422);
  assert.equal(r?.code, CODE_FEED_REQUIRED);
  assert.match(r?.text ?? "", /"feed"/);
  assert.match(r?.text ?? "", /deal \(福利\)/);
});

test("feed-guard: 主人发 HTML 放行, 普通文字放行, feed 校验标签", () => {
  assert.equal(feedGuard(FEED_GROUP, { html: "<div>x</div>" }, true), null);
  assert.equal(feedGuard(FEED_GROUP, { title: "已接入" }, false), null);
  assert.equal(feedGuard(FEED_GROUP, { feed: { items: [ITEM] } }, false), null);
  assert.equal(feedGuard(FEED_GROUP, { feed: { items: [{ ...ITEM, kind: "nope" }] } }, false)?.status, 400);
});
