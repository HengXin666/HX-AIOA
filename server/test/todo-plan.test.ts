import assert from "node:assert/strict";
import { test } from "node:test";
import { memSql } from "./sql";

const { TODO_COLL, TODO_PLUGIN, checkTodoBody, parseTodoInput } = await import("@hx-aioa/protocol");
const { addEvery, nextDue, fireAt } = await import("../src/plugins/todo-plan");
const { normTodo, TodoStore } = await import("../src/plugins/todos");
const { PDataStore } = await import("../src/plugins/pdata");
const { TodoRemind } = await import("../src/plugins/todo-remind");
const { Timers } = await import("../src/timers");
const { ahead, localTime, remindKey } = await import("../src/plugins/todo-notice");

const CH = "plugin-todo";
const OWNER = "u_owner";
const MIN = 60_000;
// 东八区 2027-01-31 09:00
const JAN31 = Date.UTC(2027, 0, 31, 1, 0);
const base = { channel: CH, title: "交电费", state: "open" as const, prio: 2 as const, created: 1 };

function fakeStorage() {
  const kv = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    kv,
    alarm: () => alarm,
    get: async (k: string) => kv.get(k),
    put: async (k: string, v: unknown) => void kv.set(k, v),
    delete: async (k: string) => kv.delete(k),
    setAlarm: async (t: number) => void (alarm = t),
    deleteAlarm: async () => void (alarm = null),
  } as unknown as DurableObjectStorage & { kv: Map<string, unknown>; alarm: () => number | null };
}

test("周期: 月底按当地日历落到短月最后一天, 天和周是固定长度", () => {
  const feb = addEvery(JAN31, { unit: "month", n: 1, tz: 480 });
  assert.equal(localTime(feb), "02-28 09:00");
  assert.equal(localTime(addEvery(JAN31, { unit: "month", n: 2, tz: 480 })), "03-31 09:00");
  assert.equal(localTime(addEvery(JAN31, { unit: "year", n: 1 })), "01-31 09:00");
  assert.equal(addEvery(JAN31, { unit: "week", n: 2 }) - JAN31, 14 * 86_400_000);
  // 东八区 12-01 00:00 是 UTC 11-30, 按 UTC 加月会错到 12-31
  const dec1 = Date.UTC(2026, 10, 30, 16, 0);
  assert.equal(localTime(addEvery(dec1, { unit: "month", n: 1, tz: 480 })), "01-01 00:00");
});

test("周期: 拖了几期才完成, 直接跳到晚于现在的那一期", () => {
  const now = JAN31 + 10 * 86_400_000;
  const next = nextDue(JAN31 - 30 * 86_400_000, { unit: "day", n: 7 }, now);
  assert.ok(next > now && next - now <= 7 * 86_400_000);
});

test("normTodo: 周期待办完成时回到 open, due 推下一期, 记 runs 与 lastDone", () => {
  const prev = { ...base, due: JAN31, every: { unit: "month" as const, n: 1, tz: 480 }, remind: 15 };
  const now = JAN31 - MIN;
  const out = normTodo(prev, { ...prev, state: "done" }, now);
  assert.equal(out.state, "open");
  assert.equal(out.doneAt, undefined);
  assert.equal(localTime(out.due!), "02-28 09:00");
  assert.equal(out.runs, 1);
  assert.equal(out.lastDone, now);
  // 非周期的照常完成
  const plain = normTodo({ ...base, due: JAN31 }, { ...base, due: JAN31, state: "done" }, now);
  assert.equal(plain.state, "done");
  assert.equal(plain.doneAt, now);
});

test("校验: 提醒与周期要有截止, 字段取值", () => {
  const id = `${CH}:t-1`;
  assert.equal(checkTodoBody(id, { ...base, due: JAN31, remind: 15, area: "生活", star: true, alarm: true, every: { unit: "month", n: 1, tz: 480 } }), null);
  assert.match(checkTodoBody(id, { ...base, remind: 15 }) ?? "", /due/);
  assert.match(checkTodoBody(id, { ...base, every: { unit: "month", n: 1 } }) ?? "", /due/);
  assert.match(checkTodoBody(id, { ...base, due: JAN31, every: { unit: "hour", n: 1 } }) ?? "", /unit/);
  assert.match(checkTodoBody(id, { ...base, area: "" }) ?? "", /area/);
  assert.match(checkTodoBody(id, { ...base, due: 1.5 }) ?? "", /due/);
  const p = parseTodoInput({ id: "t-1", area: " 生活 ", due: JAN31, remind: 0, every: null });
  assert.deepEqual(p, { id: "t-1", area: "生活", due: JAN31, remind: 0, every: null });
  assert.equal(typeof parseTodoInput({ id: "t-1", remind: -1 }), "string");
});

test("旧接口 upsert: 计划字段可写可清, 缺截止的提醒被拒", () => {
  const sql = memSql();
  const store = new TodoStore(sql, new PDataStore(sql), () => OWNER, (fn) => fn());
  const r = store.upsert(CH, [{ id: "t-1", title: "交电费", area: "生活", due: JAN31, remind: 15, every: { unit: "month", n: 1 } }]);
  assert.ok(typeof r !== "string");
  assert.equal(store.get(CH, "t-1")?.area, "生活");
  assert.equal(typeof store.upsert(CH, [{ id: "t-1", due: null }]), "string");
  store.upsert(CH, [{ id: "t-1", remind: null, every: null, due: null }]);
  assert.equal(store.get(CH, "t-1")?.due, undefined);
});

test("提醒: 只发 (上次, 现在] 之间的, 完成的和停用账号的不发, 发完排下一个", async () => {
  const sql = memSql();
  const pdata = new PDataStore(sql);
  const storage = fakeStorage();
  const timers = new Timers(storage);
  const sent: string[] = [];
  const off = new Set<string>();
  const remind = new TodoRemind(pdata, timers, storage, async (d) => void sent.push(remindKey(d.id, d.at)), (a) => !off.has(a));
  const t0 = JAN31 - 60 * MIN;
  storage.kv.set("todo_remind_last", t0);
  const put = (acct: string, id: string, extra: Record<string, unknown>) => pdata.put(acct, TODO_PLUGIN, TODO_COLL, `${CH}:${id}`, 0, { ...base, ...extra });
  put(OWNER, "a", { due: JAN31, remind: 15 });
  put(OWNER, "b", { due: JAN31 + 60 * MIN, remind: 0 });
  put(OWNER, "c", { due: JAN31, remind: 15, state: "done" });
  put("u_m", "d", { due: JAN31, remind: 15 });
  off.add("u_m");
  assert.equal(await remind.plan(), JAN31 - 15 * MIN);
  assert.equal(storage.alarm(), JAN31 - 15 * MIN);
  assert.equal(await remind.fire(JAN31 - 10 * MIN), 1);
  assert.deepEqual(sent, [`todo:${CH}:a:${JAN31 - 15 * MIN}`]);
  // 下一个是 b 的到点
  assert.equal(await timers.get("todo_remind"), JAN31 + 60 * MIN);
  // 重复到点不重发
  assert.equal(await remind.fire(JAN31 - 5 * MIN), 0);
  // 过了 6 小时才醒: 过时的不补
  assert.equal(await remind.fire(JAN31 + 8 * 60 * MIN), 0);
  assert.equal(storage.alarm(), null);
  assert.equal(fireAt({ ...base, due: JAN31 }), null);
});

test("提醒文案: 提前量与当地时间", () => {
  assert.equal(ahead(15), "15 分钟");
  assert.equal(ahead(120), "2 小时");
  assert.equal(ahead(1440), "1 天");
  assert.equal(localTime(JAN31, 0), "01-31 01:00");
});

test("周期: 按月逐期推, 31 号在短月落月底, 下一期回到 31 号", () => {
  let b = { ...base, due: JAN31, every: { unit: "month" as const, n: 1, tz: 480 } };
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    b = normTodo(b, { ...b, state: "done" }, b.due - MIN) as typeof b;
    seen.push(localTime(b.due));
  }
  assert.deepEqual(seen, ["02-28 09:00", "03-31 09:00", "04-30 09:00"]);
  assert.equal(b.every.day, 31);
  // 新建时就是完成的不推
  assert.equal(normTodo(null, { ...b, state: "done" }).state, "done");
});

test("GitHub 同步: 关联了已关闭 issue 的周期待办不跟着完成推期", () => {
  const sql = memSql();
  const store = new TodoStore(sql, new PDataStore(sql), () => OWNER, (fn) => fn());
  store.upsert(CH, [{ id: "t-1", title: "周报", repo: "o/r", issue: 3, due: JAN31, every: { unit: "week", n: 1 } }]);
  const gh = { state: "closed" as const, comments: 0, synced: 1 };
  store.setGh(CH, "t-1", gh, "done");
  store.setGh(CH, "t-1", { ...gh, synced: 2 }, "done");
  const t = store.get(CH, "t-1")!;
  assert.equal(t.state, "open");
  assert.equal(t.due, JAN31);
  assert.equal(t.runs, undefined);
});

test("提醒: 写入时提醒时刻已过的不补发", async () => {
  const sql = memSql();
  const pdata = new PDataStore(sql);
  const storage = fakeStorage();
  const sent: string[] = [];
  const remind = new TodoRemind(pdata, new Timers(storage), storage, async (d) => void sent.push(d.id), () => true);
  storage.kv.set("todo_remind_last", 0);
  const now = Date.now();
  pdata.put(OWNER, TODO_PLUGIN, TODO_COLL, `${CH}:old`, 0, { ...base, due: now - 10 * MIN, remind: 0 }, now);
  pdata.put(OWNER, TODO_PLUGIN, TODO_COLL, `${CH}:soon`, 0, { ...base, due: now + MIN, remind: 0 }, now);
  assert.equal(await remind.fire(now + 2 * MIN), 1);
  assert.deepEqual(sent, [`${CH}:soon`]);
});
