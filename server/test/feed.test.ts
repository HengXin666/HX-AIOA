import assert from "node:assert/strict";
import { test } from "node:test";
import { feedText, parseFeed, parseEventInput } from "@hx-aioa/protocol";
import { messageInput } from "../src/api-events";

const ITEMS = [
  { title: "FreeDns 二级域名永久有效", url: "https://www.nodeloc.com/t/1", kind: "deal", status: "ok", todo: "去注册", heat: 12 },
  { title: "混元免费 API", url: "https://nodeloc.com/t/2", kind: "deal", status: "go", until: "2026-11-30", links: [{ label: "帖子", url: "https://nodeloc.com/t/2" }] },
  { title: "某开源项目", kind: "oss", site: "GitHub.com" },
];

test("feed: 校验与站点推断", () => {
  const f = parseFeed({ source: "NodeLoc", items: ITEMS });
  assert.ok(typeof f !== "string");
  assert.equal(f.items[0]!.site, "nodeloc.com");
  assert.equal(f.items[2]!.site, "github.com");
  assert.match(parseFeed({ items: [{ title: "x", status: "good" }] }) as string, /status/);
  assert.match(parseFeed({ items: [{ title: "x", url: "javascript:1" }] }) as string, /url/);
  assert.match(parseFeed({ items: [] }) as string, /items/);
});

test("feed: 通知摘要按类别计数", () => {
  const f = parseFeed({ source: "NodeLoc", items: ITEMS });
  assert.ok(typeof f !== "string");
  assert.equal(feedText(f).split("\n")[0], "NodeLoc 新到 3 条: 福利 2 (有效 2) · 开源 1");
});

test("feed: 消息与事件两种入口都能带", () => {
  const m = messageInput({ feed: { items: ITEMS } });
  assert.ok(typeof m !== "string");
  assert.equal((m.data as { feed?: { items: unknown[] } }).feed?.items.length, 3);
  const e = parseEventInput({ kind: "event", feed: { items: ITEMS } });
  assert.ok(e.ok);
  assert.match((e.value.data as { title: string }).title, /新到 3 条/);
});
