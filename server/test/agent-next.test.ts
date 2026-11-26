import assert from "node:assert/strict";
import { test } from "node:test";
import { HANDLED_SET_MAX, HEADER_SKILL, PATH_CHAT_AGENT, type ChatAgent, type Envelope } from "@hx-aioa/protocol";
import { advance, initialHandled, parseEvery, pendingOf } from "../src/agent-cursor";
import { bumpSetup, majorRemind, noteSkill } from "../src/agent-want";
import { AGENT_NEXT_ROUTES, coversOf, markDone } from "../src/api-agent-next";
import { CHAT_ROUTES } from "../src/api-chats";
import { ChatStore } from "../src/chat-store";
import type { Core, Principal } from "../src/core";
import { PluginStore } from "../src/plugins/store";
import { EventStore } from "../src/store";
import { memSql } from "./sql";

const CH = "plugin-todo";
const KEY = "k1";
const SRC = "s_agent";
const PLUGIN = "hengxin666.todo";
const BASE = "https://hub.test";
const HUMAN = { id: "user:u1", name: "主人", type: "user" };
const BOT = { id: SRC, name: "整理员", type: "agent" };

function setup(agent: Partial<ChatAgent> = {}) {
  const sql = memSql();
  const store = new EventStore(sql, (fn) => fn());
  const chats = new ChatStore(sql);
  const plugins = new PluginStore(sql);
  const notices: string[] = [];
  let n = 0;
  const core = {
    store,
    chats,
    plugins,
    kernel: { get: () => undefined },
    market: { sources: () => [] },
    sockets: { toAllClients() {}, toV1Clients() {}, chatSockets: () => [] },
    presence: { polled() {}, sent() {} },
    registry: { key: () => null, source: () => null },
    pipeline: { fromInput: async (input: { data: { title?: string; summary?: string; text?: string } }) => void notices.push(JSON.stringify(input.data)) },
  } as unknown as Core;
  chats.replaceChat({ channel: CH, title: "点子待办", updated: 1, agents: [{ keyId: KEY, sourceId: SRC, name: "整理员", reads: [CH], created: 1000, ...agent }] });
  const say = (source = HUMAN, ts = 2000) => {
    n += 1;
    return store.put({ id: `m${n}`, seq: 0, ts, kind: "event", source, channel: CH, priority: "happening", data: { title: `消息 ${n}` } } as unknown as Envelope).seq;
  };
  const me = () => chats.chat(CH)!.agents!.find((a) => a.keyId === KEY)!;
  const who = { owner: false, key: { id: KEY, scopes: ["messages:send", "events:read"], channels: [CH] } } as unknown as Principal;
  return { core, say, me, who, notices, plugins };
}

async function call(core: Core, who: Principal, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const url = new URL(BASE + path);
  const routes = [...AGENT_NEXT_ROUTES, ...CHAT_ROUTES];
  const r = routes.find((x) => x.method === method && x.re.test(url.pathname))!;
  const params = r.re.exec(url.pathname)!.slice(1);
  const req = new Request(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const res = await r.handler({ req, url, params, who, core });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("游标初始化: 老 Agent 用它在本群最后一条消息, 没发过取接入前最后一条", () => {
  const a = setup();
  a.say();
  const mine = a.say(BOT);
  a.say();
  assert.equal(initialHandled(a.core, CH, a.me()), mine);
  const b = setup({ joined: 5000 });
  const before = b.say(HUMAN, 4000);
  b.say(HUMAN, 6000);
  assert.equal(initialHandled(b.core, CH, b.me()), before);
  const c = setup();
  assert.equal(initialHandled(c.core, CH, c.me()), 0);
});

test("next: 第一次把初始化的游标写下, 两条连发都返回, covers 后清空 (#114)", async () => {
  const a = setup();
  a.say(BOT);
  const s1 = a.say();
  const s2 = a.say();
  const r = await call(a.core, a.who, "GET", "/api/v1/chat-agent/next?start=1");
  assert.deepEqual((r.body.pending as Envelope[]).map((e) => e.seq), [s1, s2]);
  assert.ok(a.me().handled !== undefined && a.me().lastRun);
  const reply = a.say(BOT);
  const done = markDone(a.core, CH, KEY, [s1, s2, reply]);
  assert.deepEqual(done, { cursor: reply, left: 0 });
  assert.equal(a.me().handledSet, undefined);
  const again = await call(a.core, a.who, "GET", "/api/v1/chat-agent/next");
  assert.deepEqual(again.body.pending, []);
});

test("handledSet: 乱序 done 只在补齐后前移, 超上限推到最小连续段之后", () => {
  const a = setup({ handled: 0 });
  const [h1, h2, h3] = [a.say(), a.say(), a.say()];
  let cur = advance(a.core, CH, { handled: 0, handledSet: [] }, [h3]);
  assert.deepEqual(cur, { handled: 0, handledSet: [h3] });
  cur = advance(a.core, CH, cur, [h1]);
  assert.deepEqual(cur, { handled: h1, handledSet: [h3] });
  assert.deepEqual(pendingOf(a.core, CH, cur).map((e) => e.seq), [h2]);
  cur = advance(a.core, CH, cur, [h2]);
  assert.deepEqual(cur, { handled: h3, handledSet: [] });
  const seqs = Array.from({ length: HANDLED_SET_MAX + 3 }, () => a.say());
  const big = advance(a.core, CH, cur, seqs.slice(1));
  assert.ok(big.handledSet.length <= HANDLED_SET_MAX);
  assert.equal(big.handled, seqs.at(-1));
});

test("next: brief 只在版本不同时带全文, memory=1 带记忆", async () => {
  const a = setup({ handled: 0 });
  const first = await call(a.core, a.who, "GET", "/api/v1/chat-agent/next?brief=&memory=1");
  const v = first.body.briefVersion as string;
  assert.ok(v && (first.body.brief as { version: string }).version === v);
  assert.equal(first.body.memory, "");
  const second = await call(a.core, a.who, "GET", `/api/v1/chat-agent/next?brief=${v}`);
  assert.equal(second.body.brief, undefined);
  assert.equal(second.body.briefVersion, v);
});

test("want 头与 skill 上报: 只在变化时写; 插件大号缺失提醒一次; 兼容期过后 next 409", async () => {
  const a = setup({ plugin: PLUGIN, setup: 1 });
  a.plugins.save({ id: PLUGIN, version: "2.2.0", name: "点子待办", channel: CH, keyId: KEY, installed: 1 }, "点子待办", "p", { skill: "2.0", changes: [{ version: "2.0", changes: "改用 todo 命令", missing: "待办写不进去", until: "2026-12-31" }] });
  const meta = () => a.core.chats.chat(CH)!;
  const req = (v: string) => new Request(BASE, { headers: { [HEADER_SKILL]: v } });
  assert.equal(await noteSkill(a.core, new Request(BASE), meta(), a.me()), `setup=1,hx-aioa@1.0,${PLUGIN}@2.0`);
  assert.equal(a.me().skills, undefined);
  await noteSkill(a.core, req(`setup=1,hx-aioa@1.0,${PLUGIN}@1.3`), meta(), a.me(), Date.UTC(2026, 11, 1));
  assert.equal(a.me().skills?.skills[PLUGIN], "1.3");
  assert.equal(a.notices.length, 1);
  assert.match(a.notices[0]!, /2\.0.*2026-12-31/);
  const updated = meta().updated;
  await noteSkill(a.core, req(`setup=1,hx-aioa@1.0,${PLUGIN}@1.3`), meta(), a.me(), Date.UTC(2026, 11, 1));
  assert.equal(a.notices.length, 1);
  assert.equal(meta().updated, updated);
  assert.equal(await majorRemind(a.core, Date.UTC(2026, 11, 2)), 0);
  assert.equal(await majorRemind(a.core, Date.UTC(2026, 11, 29)), 1);
  assert.equal(await majorRemind(a.core, Date.UTC(2026, 11, 30)), 0);
  assert.equal(a.me().warned?.length, 2);
  assert.equal((await call(a.core, a.who, "GET", "/api/v1/chat-agent/next")).status, 200);
  a.plugins.save(a.plugins.get(PLUGIN)!, "点子待办", "p", { skill: "2.0", changes: [{ version: "2.0", changes: "x", missing: "y", until: "2026-01-01" }] });
  const late = await call(a.core, a.who, "GET", "/api/v1/chat-agent/next");
  assert.equal(late.status, 409);
  assert.equal(late.body.code, "skill_major_expired");
});

test("PATCH agent: autoMajor 变化时 setup + 1, 没变不加", async () => {
  const a = setup({ setup: 1 });
  const owner = { owner: true } as Principal;
  const path = PATH_CHAT_AGENT.replace("{channel}", CH).replace("{keyId}", KEY);
  await call(a.core, owner, "PATCH", path, { autoMajor: true });
  assert.equal(a.me().setup, 2);
  assert.equal(a.me().autoMajor, true);
  await call(a.core, owner, "PATCH", path, { autoMajor: true });
  assert.equal(a.me().setup, 2);
  const prompt = await call(a.core, owner, "GET", `${path}/prompt`);
  assert.match(prompt.body.prompt as string, /有大更新[\s\S]*--setup 2[\s\S]*hxaioa upgrade/);
  assert.doesNotMatch(prompt.body.prompt as string, /hxaioa login/);
});

test("trigger: 解析 every, 同一表达式不重写", async () => {
  assert.equal(parseEvery("every 2h"), 7200);
  assert.equal(parseEvery("every 30 minutes"), 1800);
  assert.equal(parseEvery("每 2 小时"), 7200);
  assert.equal(parseEvery("每天"), 86_400);
  assert.equal(parseEvery("*/30 * * * *"), 1800);
  assert.equal(parseEvery("0 */2 * * *"), 7200);
  assert.equal(parseEvery("900"), 900);
  assert.equal(parseEvery("0 9 * * 1"), undefined);
  const a = setup();
  const r = await call(a.core, a.who, "POST", "/api/v1/chat-agent/trigger", { expr: "*/30 * * * *" });
  assert.deepEqual({ ...(r.body.trigger as object), at: 0 }, { expr: "*/30 * * * *", every: 1800, at: 0 });
  const at = a.me().trigger!.at;
  await call(a.core, a.who, "POST", "/api/v1/chat-agent/trigger", { expr: "*/30 * * * *" });
  assert.equal(a.me().trigger!.at, at);
});

test("trigger: 具体时刻的 cron 也收下, tz 校验后存下, 不带 tz 时沿用旧的", async () => {
  const a = setup();
  const path = "/api/v1/chat-agent/trigger";
  const r = await call(a.core, a.who, "POST", path, { expr: "0 9,18 * * *", tz: "Asia/Shanghai" });
  assert.equal(r.status, 200);
  assert.deepEqual({ ...a.me().trigger!, at: 0 }, { expr: "0 9,18 * * *", at: 0, tz: "Asia/Shanghai" });
  assert.equal((await call(a.core, a.who, "POST", path, { expr: "30 8 * * 1-5", tz: "Mars/Base" })).status, 400);
  assert.equal((await call(a.core, a.who, "POST", path, { expr: "30 8 * * 1-5", tz: 8 })).status, 400);
  assert.equal(a.me().trigger!.expr, "0 9,18 * * *");
  await call(a.core, a.who, "POST", path, { expr: "30 8 * * 1-5" });
  assert.deepEqual({ ...a.me().trigger!, at: 0 }, { expr: "30 8 * * 1-5", at: 0, tz: "Asia/Shanghai" });
  await call(a.core, a.who, "POST", path, { expr: "30 8 * * 1-5", tz: "UTC" });
  assert.equal(a.me().trigger!.tz, "UTC");
});

test("covers: 只给群 Agent, seq 必须是正整数数组", () => {
  const a = setup();
  assert.match(coversOf(a.core, { owner: true } as Principal, [1]) as string, /Agent/);
  assert.match(coversOf(a.core, a.who, [0]) as string, /covers/);
  assert.deepEqual(coversOf(a.core, a.who, [3, 4]), { channel: CH, keyId: KEY, seqs: [3, 4] });
  assert.equal(coversOf(a.core, a.who, undefined), null);
});

test("插件更新: skill 大号变了才让它的 Agent setup + 1", () => {
  const a = setup({ plugin: PLUGIN, setup: 1 });
  bumpSetup(a.core, PLUGIN, "1.0", "1.4");
  assert.equal(a.me().setup, 1);
  bumpSetup(a.core, PLUGIN, "1.4", "2.0");
  assert.equal(a.me().setup, 2);
  bumpSetup(a.core, "other.plugin", "1.0", "2.0");
  assert.equal(a.me().setup, 2);
});
