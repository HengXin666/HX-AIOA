import assert from "node:assert/strict";
import { test } from "node:test";
import { GITHUB_HEATMAP_DAYS, type GithubActivityItem } from "@hx-aioa/protocol";
import { ActivityStore } from "../src/github/activity";
import { commitsByDate, dateIn, heatDates, lastDates, recentDates, yearDates } from "../src/github/heatmap";
import { GithubService } from "../src/github/service";
import { memSql } from "./sql";
import { memKv } from "./github-kv";

const TZ = "Asia/Shanghai";
const NOW = Date.parse("2026-11-27T22:30:00+08:00");
const DAY = 24 * 3600_000;
const push = (ts: number, commits?: number): GithubActivityItem => ({ id: `p${ts}`, ts, kind: "push", repo: "a/b", title: "推送", url: "", ...(commits ? { commits } : {}) });

test("热力图日期: 按 IANA 时区分天, 最近 140 天与按年都从早到晚 (#134)", () => {
  assert.equal(dateIn(Date.parse("2026-11-28T01:00:00+08:00"), TZ), "2026-11-28");
  assert.deepEqual(lastDates("2026-03-02", 3), ["2026-02-28", "2026-03-01", "2026-03-02"]);
  const m = commitsByDate([push(NOW, 3), push(NOW - 1000), { ...push(NOW, 9), kind: "pr" }], TZ);
  assert.equal(m.get("2026-11-27"), 4);
  assert.equal(yearDates(2024, "2026-11-27").length, 366);
  assert.deepEqual(yearDates(2026, "2026-01-02"), ["2026-01-01", "2026-01-02"]);
  assert.deepEqual(yearDates(2027, "2026-11-27"), []);
  // 11-27 往前 140 天是 07-11 (周六), 补到 07-06 (周一)
  assert.equal(heatDates("2026-11-27").length, GITHUB_HEATMAP_DAYS + 5);
});

test("服务: 第一次读当场算, 动态并进年份行; 旧的累计行迁移后删掉; 新提交改变 ETag (#134)", async () => {
  const sql = memSql();
  const kv = memKv();
  await kv.storage.put("githubHeatmap", { days: { "2026-08-01": 7, "2025-12-01": 5 }, updated: 1 });
  const svc = new GithubService({} as never, sql, kv.storage, { sources: () => [] } as never);
  const acts = new ActivityStore(sql);
  acts.add([push(NOW - 3 * DAY, 2), push(NOW - 3 * DAY + 1000, 1)], NOW);
  const a = await svc.heatmap(TZ, NOW);
  assert.equal(a.map.days.length, GITHUB_HEATMAP_DAYS + 5);
  assert.equal(a.map.days.find((x) => x.date === dateIn(NOW - 3 * DAY, TZ))?.commits, 3);
  assert.equal(a.map.days.find((x) => x.date === "2026-08-01")?.commits, 7);
  assert.deepEqual(a.map.years, [2026, 2025]);
  assert.equal(kv.map.has("githubHeatmap"), false);
  assert.ok(kv.map.has("githubHeat:2026") && kv.map.has("githubHeat:2025"));
  const writes = kv.writes();
  const b = await svc.heatmap(TZ, NOW);
  assert.equal(b.tag, a.tag);
  assert.equal(kv.writes(), writes, "读不写");
  acts.add([push(NOW - 1000, 4)], NOW);
  const c = await svc.heatmap(TZ, NOW);
  assert.notEqual(c.tag, a.tag);
  assert.equal(c.map.days.at(-1)?.commits, 4);
  const y = await svc.heatmap(TZ, NOW, 2025);
  assert.equal(y.map.year, 2025);
  assert.equal(y.map.days.length, 365);
  assert.equal(y.map.days.find((x) => x.date === "2025-12-01")?.commits, 5);
  assert.notEqual(y.tag, a.tag);
});

test("每天 cron 再跑一次: 同一天取较大值, 不重复累加 (#134)", async () => {
  const sql = memSql();
  const kv = memKv();
  const svc = new GithubService({} as never, sql, kv.storage, { sources: () => [] } as never);
  new ActivityStore(sql).add([push(NOW - 5 * DAY, 3)], NOW);
  await svc.refreshHeatmap(TZ, NOW);
  await svc.refreshHeatmap(TZ, NOW + DAY);
  const h = await svc.heatmap(TZ, NOW + DAY);
  assert.equal(h.map.days.find((x) => x.date === dateIn(NOW - 5 * DAY, TZ))?.commits, 3);
});

test("最近窗口按周一补齐: 第一列不留空格, 那几天的提交照样给 (#144)", () => {
  const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  // 线上 bug: 11-28 (周六) 往前 140 天从 07-12 (周日) 起, 安卓补 6 个空格, 07-06..07-11 其实有提交
  const r = recentDates("2026-11-28");
  assert.equal(r[0], "2026-07-06");
  assert.equal(r.at(-1), "2026-11-28");
  assert.equal(r.length, GITHUB_HEATMAP_DAYS + 6);
  // 一周里每一天作今天都从周一起, 至少 140 天, 最多多补 6 天
  for (let k = 0; k < 7; k++) {
    const today = lastDates("2026-11-30", 7)[k] as string;
    const d = recentDates(today);
    assert.equal(dow(d[0] as string), 1, today);
    assert.ok(d.length >= GITHUB_HEATMAP_DAYS && d.length < GITHUB_HEATMAP_DAYS + 7, today);
    assert.deepEqual(d.slice(-GITHUB_HEATMAP_DAYS), lastDates(today, GITHUB_HEATMAP_DAYS));
  }
  // 起点刚好是周一时不多补
  assert.equal(recentDates("2026-11-29").length, GITHUB_HEATMAP_DAYS);
});
