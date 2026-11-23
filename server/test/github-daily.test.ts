import assert from "node:assert/strict";
import { test } from "node:test";
import type { GithubActivityItem } from "@hx-aioa/protocol";
import { dailyOf, dayStart, streakOf } from "../src/github/daily";

const TZ = 480;
const NOW = Date.parse("2026-11-23T14:00:00Z"); // 北京时间 22:00
const item = (ts: number, kind: GithubActivityItem["kind"], title: string, extra: Partial<GithubActivityItem> = {}): GithubActivityItem => ({ id: `${ts}${title}`, ts, kind, repo: "a/b", title, url: "", ...extra });

test("按本地时区分天, 推断旧数据的动作", () => {
  const today = dayStart(NOW, TZ);
  const items = [
    item(today + 1000, "push", "推送到 main", { commits: 3 }),
    item(today + 2000, "push", "推送到 main"),
    item(today + 3000, "pr", "合并 PR #1 x"),
    item(today + 4000, "pr", "x", { action: "opened" }),
    item(today - 1000, "issue", "关闭 Issue #2 y"),
    item(today - 2000, "issue", "打开 Issue #3 z"),
  ];
  const days = dailyOf(items, NOW, 3, TZ);
  assert.deepEqual(days.map((d) => d.day), ["2026-11-21", "2026-11-22", "2026-11-23"]);
  assert.equal(days[2]?.commits, 4);
  assert.equal(days[2]?.pushes, 2);
  assert.equal(days[2]?.prMerged, 1);
  assert.equal(days[2]?.prOpened, 1);
  assert.equal(days[1]?.issueClosed, 1);
  assert.equal(days[1]?.issueOpened, 1);
  assert.equal(streakOf(days), 2);
});

test("今天还没动静不算断", () => {
  const today = dayStart(NOW, TZ);
  assert.equal(streakOf(dailyOf([item(today - 1000, "comment", "评论")], NOW, 3, TZ)), 1);
});
