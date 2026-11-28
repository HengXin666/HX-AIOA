import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ev, fakeServer, home, readJsonFile, run } from "./helpers.mjs";

const BRIEF = { version: "b1", name: "イデア", channel: "g1", title: "点子待办", reads: ["g1"], skills: [], want: { setup: 1, skills: {} }, missing: [] };
const CFG = { me: { name: "イデア", channel: "g1", sourceId: "agent:1" } };

// pending 由 queue() 决定; 简报只在 brief 参数不是 b1 时带全文
function server(queue, opts) {
  return fakeServer(({ path, query }) => {
    if (path === "/api/v1/chat-agent/next") {
      const pending = queue();
      return { json: { pending, head: 100, cursor: 90, briefVersion: "b1", ...(query.brief === "b1" ? {} : { brief: BRIEF }), ...(query.memory ? { memory: "主人喜欢短回复" } : {}) } };
    }
    if (path === "/api/v1/chats/g1/messages") return { json: { messages: [], head: 100 } };
  }, opts);
}

const lastLine = (s) => s.trimEnd().split("\n").at(-1);
const nexts = (srv) => srv.reqs.filter((q) => q.path === "/api/v1/chat-agent/next");

test("next: 本轮第一次带 start=1&memory=1, 有消息退出 0, 同一轮下次不再带", async () => {
  const srv = await server(() => [ev(101, "买牛奶"), ev(102, "第二行\n继续")]);
  const dir = home(CFG);
  try {
    const a = await run(dir, srv.base, ["next", "--wait", "300"]);
    assert.equal(a.code, 0, a.stderr);
    assert.match(a.stdout, /== 简报 b1/);
    assert.match(a.stdout, /== 长期记忆\n主人喜欢短回复/);
    assert.match(a.stdout, /== 待处理 2 条\n#101 .* 主人: 买牛奶\n#102 .* 主人: 第二行\n  继续/);
    assert.match(lastLine(a.stdout), /^下一步: .*--covers.*hxaioa next --wait 300$/);
    assert.deepEqual([nexts(srv)[0].query.start, nexts(srv)[0].query.memory, nexts(srv)[0].query.brief], ["1", "1", ""]);

    const b = await run(dir, srv.base, ["next", "--wait", "300"]);
    assert.equal(b.code, 0);
    const q = nexts(srv)[1].query;
    assert.equal(q.start, undefined);
    assert.equal(q.memory, undefined);
    assert.equal(q.brief, "b1");
    assert.doesNotMatch(b.stdout, /简报|长期记忆/);
  } finally {
    await srv.close();
  }
});

test("next: 没消息时窗口没满退出 10, 再跑接着等 (不重新计时), 满了 idle 退出 2", async () => {
  const srv = await server(() => []);
  const dir = home(CFG);
  try {
    const t0 = Date.now();
    const a = await run(dir, srv.base, ["next", "--wait", "5", "--timeout", "1"]);
    assert.equal(a.code, 10, `${Date.now() - t0}ms ${a.stdout}${a.stderr}`);
    assert.match(lastLine(a.stdout), /^下一步: 原样再跑 hxaioa next --wait 5$/);
    const until = readJsonFile(join(dir, "state.json")).round.until;
    assert.ok(until >= t0 + 5000 && until <= Date.now() + 5000);

    const b = await run(dir, srv.base, ["next", "--wait", "5", "--timeout", "1"]);
    assert.equal(b.code, 10);
    assert.equal(readJsonFile(join(dir, "state.json")).round.until, until);

    const c = await run(dir, srv.base, ["next", "--wait", "5", "--timeout", "8"]);
    assert.equal(c.code, 2, c.stdout);
    assert.match(c.stdout, /idle: 本轮结束/);
    assert.match(lastLine(c.stdout), /^下一步: /);
    assert.ok(Date.now() - t0 < 8000);
    assert.equal(readJsonFile(join(dir, "state.json")).round, undefined);
    assert.equal(nexts(srv).filter((q) => q.query.start === "1").length, 1);
    assert.deepEqual(readJsonFile(join(dir, "state.json")).heads ?? {}, {});

    // 本轮结束后下一次是新的一轮
    await run(dir, srv.base, ["next"]);
    assert.equal(nexts(srv).at(-1).query.start, "1");
  } finally {
    await srv.close();
  }
});

test("next: 不带 --wait 没消息直接 idle", async () => {
  const srv = await server(() => []);
  try {
    const r = await run(home(CFG), srv.base, ["next"]);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /idle: 本轮结束\n下一步: /);
  } finally {
    await srv.close();
  }
});

test("next --wait: 长连等到人发的消息就重新取待处理, 退出 0; 别的 Agent 的消息不叫醒", async () => {
  let pending = [];
  const srv = await server(() => pending, { ws: true });
  srv.srv.on("ws", () => {
    setTimeout(() => srv.push({ t: "ev", ev: ev(150, "别的 Agent", "agent") }), 200);
    setTimeout(() => {
      pending = [ev(151, "在吗")];
      srv.push({ t: "ev", ev: ev(151, "在吗") });
    }, 500);
  });
  try {
    const r = await run(home(CFG), srv.base, ["next", "--wait", "20", "--timeout", "10"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /#151 .* 主人: 在吗/);
    assert.doesNotMatch(r.stdout, /#150/);
    assert.equal(nexts(srv).length, 2);
    assert.equal(srv.reqs.find((q) => q.method === "WS").query.since, "100");
  } finally {
    await srv.close();
  }
});

test("next: 过了大版本兼容期 (409) 最后一行让停下告诉主人", async () => {
  const srv = await fakeServer(() => ({ status: 409, json: { error: "旧版 skill 已过兼容期", code: "skill_major_expired" } }));
  try {
    const r = await run(home(CFG), srv.base, ["next"]);
    assert.equal(r.code, 1);
    assert.match(lastLine(r.stdout), /^下一步: .*告诉主人/);
  } finally {
    await srv.close();
  }
});

test("next: 空闲且服务端要求重算定时退出 11; plan 把额度交给服务端并打印 cron", async () => {
  const result = { mode: "fitted", budget: "quota", cost: 0.5, runsPerDay: 7, perHour: [0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 1, ...new Array(13).fill(0)], cron: ["0,10,20,30,40,50 9 * * *", "0 10 * * *"], single: "0,30 9,10 * * *", peakHour: 9, peakIntervalMin: 10, daysUntilReset: 10, events: 40, days: 14, tz: "Asia/Shanghai" };
  const srv = await fakeServer(({ path }) => {
    if (path === "/api/v1/chat-agent/next") return { json: { pending: [], head: 100, cursor: 90, briefVersion: "b1", brief: BRIEF, replan: true } };
    if (path === "/api/v1/chat-agent/plan") return { json: result };
  });
  const dir = home(CFG);
  try {
    const a = await run(dir, srv.base, ["next"]);
    assert.equal(a.code, 11, a.stdout + a.stderr);
    assert.match(lastLine(a.stdout), /schedule\.md/);
    const bad = await run(dir, srv.base, ["plan", "--pool-used", "60"]);
    assert.equal(bad.code, 1);
    const b = await run(dir, srv.base, ["plan", "--pool-used", "60", "--pool-reset", "2026-12-08T00:00:00+08:00", "--daily-used", "10"]);
    assert.equal(b.code, 0, b.stderr);
    assert.deepEqual(srv.reqs.find((q) => q.path === "/api/v1/chat-agent/plan").body, { poolUsed: 60, dailyUsed: 10, poolReset: "2026-12-08T00:00:00+08:00" });
    assert.match(b.stdout, /每天 7 次, 高峰 9 点每 10 分钟一次/);
    assert.match(b.stdout, /  0,10,20,30,40,50 9 \* \* \*/);
    assert.match(lastLine(b.stdout), /hxaioa me --trigger/);
  } finally {
    await srv.close();
  }
});
