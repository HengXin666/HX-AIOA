import { TODO_PLUGIN } from "@hx-aioa/protocol";
import { messageInput } from "../api-events";
import type { Core } from "../core";
import type { Timers } from "../timers";
import type { PDataStore } from "./pdata";
import { DEFAULT_TZ_MIN } from "./todo-plan";
import { TodoRemind, type Due } from "./todo-remind";

const MIN_MS = 60_000;
const HOUR_MIN = 60;
const DAY_MIN = 1440;
export const TODO_REMIND_SOURCE = { id: "system:todo", name: "待办提醒", icon: "alarm-clock" };
const ALARM_SUFFIX = ":alarm";

const pad = (n: number) => String(n).padStart(2, "0");

/** 当地时间 "11-27 18:00" (按待办自带的时区, 没有就东八区)。 */
export function localTime(ts: number, tz = DEFAULT_TZ_MIN): string {
  const d = new Date(ts + tz * MIN_MS);
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 提前量写成人话: 15 分钟 / 2 小时 / 1 天。 */
export function ahead(min: number): string {
  if (min % DAY_MIN === 0) return `${min / DAY_MIN} 天`;
  if (min % HOUR_MIN === 0) return `${min / HOUR_MIN} 小时`;
  return `${min} 分钟`;
}

/** 提醒的去重键: 同一条同一次提醒只有一条消息, 安卓本地闹钟用同一个键, 不重复响。 */
export const remindKey = (id: string, at: number) => `todo:${id}:${at}`;

/**
 * 来源按账号分开 (同来源同去重键会覆盖, 不能让别的账号改到主人的提醒); 设了闹钟的带 :alarm,
 * 安卓本地没挂上闹钟时, 按这个后缀用闹钟渠道响铃。
 */
export function remindSource(core: Core, d: Due) {
  const who = d.acct === core.users.ownerId() ? "" : `:${d.acct}`;
  return { ...TODO_REMIND_SOURCE, id: `${TODO_REMIND_SOURCE.id}${who}${d.body.alarm ? ALARM_SUFFIX : ""}` };
}

/** 离截止还有多久 (按发出时算, 重试或晚到时不会写错)。 */
function leadText(due: number, now: number, tz?: number): string {
  const when = localTime(due, tz);
  const left = Math.round((due - now) / MIN_MS);
  if (left > 0) return `还有 ${ahead(left)} 截止 (${when})`;
  return left === 0 ? `现在到点 (${when})` : `已逾期 ${ahead(-left)} (${when})`;
}

/** 发到待办所在的群, 优先级 "需要我" (总览顶上, 手机弹通知)。 */
export async function postReminder(core: Core, d: Due, now = Date.now()): Promise<void> {
  const b = d.body;
  const lead = leadText(b.due!, now, b.every?.tz);
  const extra = [b.area ? `分区: ${b.area}` : "", b.every ? "周期待办, 完成后自动排到下一期" : ""].filter(Boolean).join("; ");
  const text = `⏰ ${b.title}\n${lead}${extra ? `\n${extra}` : ""}`;
  const input = messageInput({ text, title: `待办提醒: ${b.title}`, channel: b.channel, priority: "need_me" });
  if (typeof input === "string") throw new Error(input);
  input.dedupeKey = remindKey(d.id, d.at);
  await core.pipeline.fromInput(input, { source: remindSource(core, d), sourceInfo: null });
}

/** 建提醒服务并补排一次 (部署或休眠醒来后; 值没变不写库); core 在微任务里才取, 构造时还没建好。 */
export function newRemind(core: () => Core, pdata: PDataStore, timers: Timers, storage: DurableObjectStorage): TodoRemind {
  const r = new TodoRemind(pdata, timers, storage, (d) => postReminder(core(), d), (acct) => core().kernel.isEnabled(acct, TODO_PLUGIN));
  r.kick();
  return r;
}
