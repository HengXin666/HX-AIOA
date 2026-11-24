import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFeedKinds, DEFAULT_FEED_TAGS, feedTagsOf, feedText, parseFeed, parseFeedTags } from "@hx-aioa/protocol";

const TAGS = [
  { id: "ai", label: "AI", desc: "模型, 额度, AI 工具" },
  { id: "deal", label: "福利", desc: "其它能领的", color: "orange" },
];

test("feed-tags: 没设置用默认四类", () => {
  assert.deepEqual(feedTagsOf(null), { tags: DEFAULT_FEED_TAGS, rev: 0 });
  assert.equal(feedTagsOf({ feedTags: TAGS as never, feedRev: 3 }).rev, 3);
});

test("feed-tags: 整表校验", () => {
  assert.ok(Array.isArray(parseFeedTags(TAGS)));
  assert.match(parseFeedTags([{ id: "Ai", label: "x", desc: "y" }]) as string, /id/);
  assert.match(parseFeedTags([{ id: "ai", label: "x" }]) as string, /desc/);
  assert.match(parseFeedTags([...TAGS, { id: "ai", label: "z", desc: "z" }]) as string, /重复/);
  assert.match(parseFeedTags([{ id: "ai", label: "x", desc: "y", color: "black" }]) as string, /color/);
});

test("feed-tags: 未声明的标签被拒, 列出可用", () => {
  assert.equal(checkFeedKinds(["ai", undefined, "deal"], TAGS as never), null);
  const bad = checkFeedKinds(["news"], TAGS as never);
  assert.match(bad ?? "", /news/);
  assert.match(bad ?? "", /ai \(AI\)/);
});

test("feed-tags: 自定义标签格式可解析, 通知用群里的标签名", () => {
  const f = parseFeed({ items: [{ title: "a", kind: "ai", status: "ok" }, { title: "b", kind: "deal" }] });
  assert.ok(typeof f !== "string");
  assert.match(feedText(f, TAGS as never), /AI 1 \(有效 1\) · 福利 1/);
  assert.match(parseFeed({ items: [{ title: "a", kind: "Bad Tag" }] }) as string, /kind/);
});
