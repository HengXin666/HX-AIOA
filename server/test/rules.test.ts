import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rule } from "@hx-aioa/protocol";
import { decide, matchRule } from "../src/rules/engine";
import { inWindow } from "../src/rules/window";
import { NOW, TZ, ev } from "./fixtures";

const none = { user: [], source: [] };
const ctx = { now: NOW, tz: TZ };

test("内置规则: need_me 强提醒, worth_reading 只进摘要, 其余普通推送", () => {
  assert.equal(decide(ev({ priority: "need_me" }), none, ctx).action, "alert");
  assert.equal(decide(ev({ priority: "worth_reading" }), none, ctx).action, "digest");
  const r = decide(ev(), none, ctx);
  assert.equal(r.action, "push");
  assert.deepEqual(r.channels, ["ws", "mipush", "wxpusher", "webpush"]);
  assert.equal(r.rule, "builtin:default");
});

test("恢复通知静默, 即使原来是 need_me", () => {
  const r = decide(ev({ priority: "need_me", data: { status: "resolved" } }), none, ctx);
  assert.equal(r.action, "silent");
  assert.equal(r.rule, "builtin:resolved");
});

test("用户规则优先, 条件之间是并且, 字段内是任一", () => {
  const rule: Rule = { id: "r1", name: "NAS 只存", enabled: true, when: { sources: ["NAS"], keywords: ["温度"], severities: ["warning", "critical"] }, action: "drop" };
  const r = decide(ev(), { user: [rule], source: [] }, ctx);
  assert.equal(r.action, "drop");
  assert.deepEqual(r.channels, []);
  assert.equal(matchRule(rule, ev({ data: { title: "风扇" } }), ctx), false);
  assert.equal(matchRule({ ...rule, enabled: false }, ev(), ctx), false);
  assert.equal(matchRule({ ...rule, when: { subjects: ["nas-*"] } }, ev({ subject: "nas-01" }), ctx), true);
  assert.equal(matchRule({ ...rule, when: { sources: ["webhook"] } }, ev(), ctx), true);
});

test("来源规则排在用户规则之后, 内置规则之前", () => {
  const src: Rule = { id: "s1", name: "来源", enabled: true, when: {}, action: "silent" };
  const usr: Rule = { id: "u1", name: "用户", enabled: true, when: { keywords: ["不存在"] }, action: "alert" };
  assert.equal(decide(ev({ priority: "need_me" }), { user: [usr], source: [src] }, ctx).rule, "s1");
});

test("免打扰时段 alert 降为 silent, bypassQuiet 例外", () => {
  // NOW 为上海时间 12:00
  const quiet = { start: "11:00", end: "13:00" };
  const r = decide(ev({ priority: "need_me" }), none, { ...ctx, quiet });
  assert.equal(r.action, "silent");
  assert.equal(r.reason, "免打扰时段");
  const vip: Rule = { id: "v", name: "紧急", enabled: true, when: { priorities: ["need_me"] }, action: "alert", bypassQuiet: true };
  assert.equal(decide(ev({ priority: "need_me" }), { user: [vip], source: [] }, { ...ctx, quiet }).action, "alert");
});

test("关联事件只推根因, 短时间同类合并计数", () => {
  const g = decide(ev(), none, { ...ctx, groupRoot: { id: "e_root", count: 3 } });
  assert.equal(g.action, "silent");
  assert.equal(g.merged, 3);
  const m = decide(ev(), none, { ...ctx, recentSame: 2 });
  assert.equal(m.action, "silent");
  assert.equal(m.merged, 2);
});

test("同一事件更新: 未升级不再响, 升级或状态变化才响", () => {
  const prev = ev({ id: "same" });
  assert.equal(decide(ev({ id: "same" }), none, { ...ctx, previous: prev }).action, "silent");
  const up = ev({ id: "same", priority: "need_me", data: { severity: "critical" } });
  assert.equal(decide(up, none, { ...ctx, previous: prev }).action, "alert");
});

test("aggregate 动作只走长连接, 等窗口结束再推", () => {
  const rule: Rule = { id: "a", name: "聚合", enabled: true, when: {}, action: "aggregate", aggregateSec: 120 };
  const r = decide(ev(), { user: [rule], source: [] }, ctx);
  assert.equal(r.action, "aggregate");
  assert.deepEqual(r.channels, ["ws"]);
});

test("时间窗: 跨午夜, 工作日与周末", () => {
  const night = Date.UTC(2026, 10, 18, 16, 30); // 上海 周四 00:30
  assert.equal(inWindow({ start: "23:00", end: "08:00" }, night, TZ), true);
  assert.equal(inWindow({ start: "23:00", end: "08:00" }, NOW, TZ), false);
  assert.equal(inWindow({ days: "weekday" }, NOW, TZ), true);
  assert.equal(inWindow({ days: "weekend" }, NOW, TZ), false);
  const satNight = Date.UTC(2026, 10, 21, 17, 0); // 上海 周日 01:00, 属于周六开始的夜间窗口
  assert.equal(inWindow({ start: "23:00", end: "08:00", days: "weekend" }, satNight, TZ), true);
  const monNight = Date.UTC(2026, 10, 23, 17, 0); // 上海 周二 01:00, 属于周一开始的窗口
  assert.equal(inWindow({ start: "23:00", end: "08:00", days: "weekend" }, monNight, TZ), false);
});
