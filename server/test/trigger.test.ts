import assert from "node:assert/strict";
import { test } from "node:test";
import { LATE_GRACE_MAX_MS, UPCOMING_MAX, dayStartAfter, isTimeZone, nextRuns, parseTrigger, triggerView } from "@hx-aioa/protocol";

// protocol/src/v1/trigger.ts: cron 与间隔写法的推算 (安卓 Trigger.kt 是同一算法)
const SH = "Asia/Shanghai";
const NY = "America/New_York";
const UTC = "UTC";
const MIN = 60_000;
const HOUR = 3_600_000;
const iso = (xs: number[]) => xs.map((x) => new Date(x).toISOString());
const at = (s: string) => Date.parse(s);

test("cron 具体时刻: 跨日", () => {
  assert.deepEqual(iso(nextRuns("0 9,18 * * *", at("2026-11-26T10:00:00+08:00"), 3, SH)), [
    "2026-11-26T10:00:00.000Z",
    "2026-11-27T01:00:00.000Z",
    "2026-11-27T10:00:00.000Z",
  ]);
  // 正好在触发点上不算 "之后"
  assert.deepEqual(iso(nextRuns("0 9 * * *", at("2026-11-26T09:00:00+08:00"), 1, SH)), ["2026-11-27T01:00:00.000Z"]);
});

test("cron 星期: 工作日跳过周末, 7 与 0 都是周日", () => {
  assert.deepEqual(iso(nextRuns("30 8 * * 1-5", at("2026-11-27T09:00:00+08:00"), 2, SH)), ["2026-11-30T00:30:00.000Z", "2026-12-01T00:30:00.000Z"]);
  const weekend = iso(nextRuns("0 10 * * 6,0", at("2026-11-26T00:00:00Z"), 3, UTC));
  assert.deepEqual(weekend, ["2026-11-28T10:00:00.000Z", "2026-11-29T10:00:00.000Z", "2026-12-05T10:00:00.000Z"]);
  assert.deepEqual(iso(nextRuns("0 10 * * 6,7", at("2026-11-26T00:00:00Z"), 3, UTC)), weekend);
});

test("cron 步长与列表: */n, a-b, a-b/n", () => {
  const from = at("2026-11-26T08:59:00Z");
  assert.deepEqual(
    iso(nextRuns("*/20 9-10 * * *", from, 7, UTC)).map((s) => s.slice(8, 16)),
    ["26T09:00", "26T09:20", "26T09:40", "26T10:00", "26T10:20", "26T10:40", "27T09:00"],
  );
  assert.deepEqual(iso(nextRuns("5-50/15 * * * *", from, 4, UTC)).map((s) => s.slice(11, 16)), ["09:05", "09:20", "09:35", "09:50"]);
  assert.deepEqual(iso(nextRuns("0 0 1,15 * *", from, 2, UTC)).map((s) => s.slice(0, 10)), ["2026-12-01", "2026-12-15"]);
});

test("cron 月底与闰日: 没有 31 号的月份跳过, 2 月 29 只在闰年, 2 月 30 无解", () => {
  assert.deepEqual(iso(nextRuns("0 0 31 * *", at("2026-11-15T00:00:00Z"), 3, UTC)).map((s) => s.slice(0, 10)), ["2026-12-31", "2027-01-31", "2027-03-31"]);
  assert.deepEqual(iso(nextRuns("0 0 29 2 *", at("2026-11-15T00:00:00Z"), 1, UTC)), ["2028-02-29T00:00:00.000Z"]);
  assert.deepEqual(nextRuns("0 0 30 2 *", at("2026-11-15T00:00:00Z"), 1, UTC), []);
});

test("cron 日与星期都限定时取并集", () => {
  assert.deepEqual(iso(nextRuns("0 0 1 * 1", at("2026-11-26T12:00:00Z"), 3, UTC)).map((s) => s.slice(0, 10)), ["2026-11-30", "2026-12-01", "2026-12-07"]);
});

test("时区: 同一 cron 按宿主时区算, 夏令时跳过的时刻不触发", () => {
  const from = at("2026-11-26T00:00:00Z");
  assert.deepEqual(iso(nextRuns("0 9 * * *", from, 1, SH)), ["2026-11-26T01:00:00.000Z"]);
  assert.deepEqual(iso(nextRuns("0 9 * * *", from, 1, NY)), ["2026-11-26T14:00:00.000Z"]);
  assert.deepEqual(iso(nextRuns("0 9 * * *", from, 1, UTC)), ["2026-11-26T09:00:00.000Z"]);
  // 2027-03-14 纽约 2:00 直接跳到 3:00
  assert.deepEqual(iso(nextRuns("30 2 * * *", at("2027-03-13T12:00:00Z"), 2, NY)), ["2027-03-15T06:30:00.000Z", "2027-03-16T06:30:00.000Z"]);
  // 无效时区按本地时区, 不报错
  assert.equal(nextRuns("0 9 * * *", from, 1, "Mars/Base").length, 1);
  assert.equal(isTimeZone(SH), true);
  assert.equal(isTimeZone("Mars/Base"), false);
  assert.equal(dayStartAfter(at("2026-11-26T23:30:00+08:00"), 1, SH), at("2026-11-27T00:00:00+08:00"));
});

test("间隔写法以 base 为基准, 无法解析返回空", () => {
  const base = at("2026-11-26T00:00:00Z");
  assert.deepEqual(nextRuns("every 2h", base + 5 * HOUR, 2, UTC, base), [base + 6 * HOUR, base + 8 * HOUR]);
  assert.deepEqual(nextRuns("每 30 分钟", base, 2, UTC, base), [base + 30 * MIN, base + 60 * MIN]);
  assert.deepEqual(nextRuns("900", base + 1, 1, UTC, base), [base + 15 * MIN]);
  for (const bad of ["早上 9 点", "61 * * * *", "0 24 * * *", "0 9 * *", "*/0 * * * *", "5/10 * * * *", "9-5 * * * *"]) assert.deepEqual(nextRuns(bad, base, 3, UTC), [], bad);
  assert.equal(parseTrigger("*/30 * * * *")?.kind, "cron");
  assert.equal(parseTrigger("every 2h")?.kind, "every");
});

test("triggerView: 下次, 今天和明天的列表, 迟到宽限 min(间隔, 30 分钟)", () => {
  const t = { expr: "0 9,18 * * *", at: at("2026-11-20T00:00:00Z"), tz: SH };
  const lastRun = at("2026-11-26T09:00:05+08:00");
  const ok = triggerView(t, lastRun, at("2026-11-26T18:20:00+08:00"), SH);
  assert.equal(ok.late, false);
  assert.equal(ok.expected, at("2026-11-26T18:00:00+08:00"));
  assert.equal(ok.next, at("2026-11-27T09:00:00+08:00"));
  assert.deepEqual(ok.upcoming, [at("2026-11-27T09:00:00+08:00"), at("2026-11-27T18:00:00+08:00")]);
  assert.equal(triggerView(t, lastRun, at("2026-11-26T18:00:00+08:00") + LATE_GRACE_MAX_MS + 1, SH).late, true);
  const short = { expr: "every 10m", at: lastRun };
  assert.equal(triggerView(short, lastRun, lastRun + 20 * MIN, SH).late, false);
  assert.equal(triggerView(short, lastRun, lastRun + 20 * MIN + 1, SH).late, true);
  assert.equal(triggerView({ expr: "*/5 * * * *", at: lastRun, tz: SH }, lastRun, lastRun, SH).upcoming.length, UPCOMING_MAX);
  const weekly = triggerView({ expr: "0 9 * * 1", at: lastRun, tz: SH }, undefined, lastRun, SH);
  assert.deepEqual(weekly.upcoming, [at("2026-11-30T09:00:00+08:00")]);
  const bad = triggerView({ expr: "看心情", at: lastRun }, lastRun, lastRun);
  assert.deepEqual([bad.parsed, bad.next, bad.upcoming, bad.late], [false, undefined, [], false]);
});
