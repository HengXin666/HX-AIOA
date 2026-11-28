import assert from "node:assert/strict";
import { test } from "node:test";
import { PATH_AGENT_NEXT, PATH_AGENT_PLAN, cronLines, hourlyOf, planSchedule, replanDue, singleCron, sqrtAllocate, uniformAllocate, type ChatAgent, type Envelope } from "@hx-aioa/protocol";
import { AGENT_NEXT_ROUTES } from "../src/api-agent-next";
import { ChatStore } from "../src/chat-store";
import type { Core, Principal } from "../src/core";
import { PluginStore } from "../src/plugins/store";
import { EventStore } from "../src/store";
import { memSql } from "./sql";

const TZ = "Asia/Shanghai";
const CH = "g1";
const KEY = "k1";
const DAY = 86_400_000;
const HOUR = 3_600_000;
// 2026-11-28 12:00 东八区
const NOW = Date.parse("2026-11-28T12:00:00+08:00");
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

test("sqrt 分配: 总数守恒, 高发时段分得多, 单小时不超上限", () => {
  const rates = new Array(24).fill(0);
  rates[9] = 16;
  rates[20] = 4;
  const a = sqrtAllocate(rates, 20, 6);
  assert.equal(sum(a), 20);
  assert.ok(a[9]! > a[20]! && a[20]! > a[3]!);
  assert.ok(a.every((n) => n <= 6));
  assert.equal(sum(sqrtAllocate(rates, 500, 6)), 144, "超过 24 x 上限时封顶");
});

test("均匀分配与 cron: 次数相同的小时合并成一行, 全天用 *", () => {
  assert.equal(sum(uniformAllocate(30, 6)), 30);
  assert.deepEqual(cronLines(uniformAllocate(24, 6)), ["0 * * * *"]);
  const a = new Array(24).fill(0);
  a[9] = 6;
  a[10] = 2;
  assert.deepEqual(cronLines(a), ["0,10,20,30,40,50 9 * * *", "0,30 10 * * *"]);
  assert.equal(singleCron(a, 6), "0,15,30,45 9,10 * * *");
});

test("重算时机: 每天 3 点后第一次, 当天算过不再算", () => {
  assert.equal(replanDue(undefined, Date.parse("2026-11-28T02:00:00+08:00"), TZ), false);
  assert.equal(replanDue(undefined, NOW, TZ), true);
  assert.equal(replanDue(NOW - HOUR, NOW, TZ), false);
  assert.equal(replanDue(NOW - DAY, NOW, TZ), true);
});

test("planSchedule: 有额度时按单次成本算每天次数, 并记下成本样本", () => {
  const hourly = hourlyOf(Array.from({ length: 40 }, (_, i) => Date.parse("2026-11-20T09:15:00+08:00") + (i % 8) * DAY), TZ);
  assert.equal(hourly[9], 40);
  const prev = { at: NOW - DAY, runs: 20, poolUsed: 50 };
  const { result, state } = planSchedule({ hourly, days: 14, quota: { poolUsed: 60, poolReset: NOW + 10 * DAY, dailyUsed: 10 }, prev, now: NOW, tz: TZ });
  // 单次 0.5%: min(40 x 0.9 / 0.5 / 10, 90 x 0.9 / 0.5) = 7
  assert.equal(result.cost, 0.5);
  assert.equal(result.runsPerDay, 7);
  assert.equal(result.mode, "fitted");
  assert.equal(result.peakHour, 9);
  assert.deepEqual(state, { at: NOW, runs: 0, poolUsed: 60, costs: [0.5] });
});

test("planSchedule: 没有额度保持现有次数; 历史不够时均匀", () => {
  const { result } = planSchedule({ hourly: new Array(24).fill(0), days: 2, currentPerDay: 48, now: NOW, tz: TZ });
  assert.equal(result.budget, "keep");
  assert.equal(result.mode, "bootstrap");
  assert.equal(result.runsPerDay, 48);
  assert.deepEqual(result.cron, ["0,30 * * * *"]);
});

function setup(agent: Partial<ChatAgent> = {}) {
  const sql = memSql();
  const store = new EventStore(sql, (fn) => fn());
  const chats = new ChatStore(sql);
  const core = {
    store,
    chats,
    plugins: new PluginStore(sql),
    kernel: { get: () => undefined },
    market: { sources: () => [] },
    sockets: { toAllClients() {}, toV1Clients() {}, toEach() {}, chatSockets: () => [] },
    presence: { polled() {}, sent() {} },
    registry: { key: () => null, source: () => null },
  } as unknown as Core;
  chats.replaceChat({ channel: CH, title: "群", updated: 1, agents: [{ keyId: KEY, sourceId: "s1", name: "a", reads: [CH], created: 1000, ...agent }] });
  let n = 0;
  const say = (ts: number) => {
    n += 1;
    store.put({ id: `m${n}`, seq: 0, ts, kind: "event", source: { id: "user:u1", name: "主人", type: "user" }, channel: CH, priority: "happening", data: { title: "x" } } as unknown as Envelope);
  };
  const me = () => chats.chat(CH)!.agents!.find((a) => a.keyId === KEY)!;
  const who = { owner: false, key: { id: KEY, scopes: ["messages:send"], channels: [CH] } } as unknown as Principal;
  return { core, say, me, who };
}

async function call(core: Core, who: Principal, method: string, path: string, body?: unknown) {
  const url = new URL(`https://hub.test${path}`);
  const r = AGENT_NEXT_ROUTES.find((x) => x.method === method && x.re.test(url.pathname))!;
  const req = new Request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const res = await r.handler({ req, url, params: r.re.exec(url.pathname)!.slice(1), who, core });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("接口: 上报过定时才要求重算; plan 记下状态, 之后每轮开始累计触发次数", async () => {
  const { core, me, who, say } = setup({ trigger: { expr: "0 * * * *", at: 1, tz: "UTC" } });
  for (let d = 1; d <= 3; d++) say(Date.now() - d * DAY);
  const first = await call(core, who, "GET", `${PATH_AGENT_NEXT}?start=1`);
  const due = replanDue(undefined, Date.now(), "UTC");
  assert.equal(first.body.replan, due ? true : undefined);
  const p = await call(core, who, "POST", PATH_AGENT_PLAN, {});
  assert.equal(p.status, 200);
  assert.equal(p.body.runsPerDay, 24, "没给额度就保持每小时一次");
  assert.equal(p.body.events, 3);
  assert.equal(me().plan?.runs, 0);
  await call(core, who, "GET", `${PATH_AGENT_NEXT}?start=1`);
  assert.equal(me().plan?.runs, 1);
  const again = await call(core, who, "GET", PATH_AGENT_NEXT);
  assert.equal(again.body.replan, undefined, "当天算过不再要求");
  const bad = await call(core, who, "POST", PATH_AGENT_PLAN, { poolUsed: 50 });
  assert.equal(bad.status, 400, "额度三项要么都给要么都不给");
});

test("去找的事件也算到达: 信息流条目按原帖时间 at 计, 同一条只算一次, 没写 at 的不算 (#165)", async () => {
  const { core, who } = setup({ trigger: { expr: "0 * * * *", at: 1, tz: "UTC" } });
  const now = Date.now();
  const items = [
    { id: "p1", title: "a", at: now - 2 * DAY },
    { id: "p2", title: "b", at: now - DAY },
    { id: "p3", title: "c" },
  ];
  const push = (n: number) =>
    core.store.put({ id: `f${n}`, seq: 0, ts: now - 1000 * n, kind: "event", source: { id: "s1", name: "a", type: "agent" }, channel: CH, priority: "info", data: { title: "f", feed: { items } } } as unknown as Envelope);
  push(1);
  push(2);
  const p = await call(core, who, "POST", PATH_AGENT_PLAN, {});
  assert.equal(p.status, 200);
  assert.equal(p.body.events, 2);
});
