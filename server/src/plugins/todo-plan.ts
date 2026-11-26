import type { TodoBody, TodoEvery } from "@hx-aioa/protocol";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
const MONTHS_PER_YEAR = 12;
// 没写时区的周期 (旧 Agent 写的) 按主人所在的东八区算月份
export const DEFAULT_TZ_MIN = 480;
// 防止异常数据死循环: 最多往后推这么多期
const MAX_STEPS = 5000;

/** 一期之后的时刻: 天和周是固定长度; 月和年按当地日历加, 月底 (31 号) 落到短月的最后一天。 */
export function addEvery(ts: number, e: TodoEvery): number {
  if (e.unit === "day") return ts + e.n * DAY_MS;
  if (e.unit === "week") return ts + e.n * WEEK_DAYS * DAY_MS;
  const off = (e.tz ?? DEFAULT_TZ_MIN) * MIN_MS;
  const d = new Date(ts + off);
  const months = e.unit === "month" ? e.n : e.n * MONTHS_PER_YEAR;
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.getTime() - off;
}

/** 下一期的截止: 从原截止往后推, 直到晚于现在 (拖了好几期才完成的, 跳过已过去的期)。 */
export function nextDue(due: number, e: TodoEvery, now: number): number {
  let next = addEvery(due, e);
  for (let i = 0; next <= now && i < MAX_STEPS; i++) next = addEvery(next, e);
  return next;
}

/** 周期待办完成一期: 回到 open, due 推到下一期, 记 runs 与 lastDone。 */
export function rollTodo(b: TodoBody, now: number): TodoBody {
  const out: TodoBody = { ...b, state: "open", due: nextDue(b.due!, b.every!, now), runs: (b.runs ?? 0) + 1, lastDone: now };
  delete out.doneAt;
  return out;
}

const FINISHED = new Set(["done", "dropped"]);

/** 该提醒的时刻: 有截止, 设了提醒, 还没完成; 否则 null。 */
export function fireAt(b: TodoBody): number | null {
  if (b.due == null || b.remind == null || FINISHED.has(b.state)) return null;
  return b.due - b.remind * MIN_MS;
}
