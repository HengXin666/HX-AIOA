import {
  PLAN_DEFAULT_TZ,
  PLAN_HISTORY_DAYS,
  PLAN_MIN_INTERVAL_MIN,
  hourlyOf,
  isTimeZone,
  nextRuns,
  planSchedule,
  type AgentPlanInput,
  type AgentTrigger,
  type Envelope,
  type PlanQuota,
} from "@hx-aioa/protocol";
import { isHuman } from "./agent-cursor";
import { putAgent } from "./agent-want";
import { agentByKey } from "./api-chats";
import { touchAgent } from "./api-presence";
import { DAY_MS } from "./constants";
import type { Core, ReqCtx } from "./core";
import { fail, json, readJson } from "./http";

// POST /chat-agent/plan (#161): 按本群近 14 天事件到达的时段与宿主额度重算定时, 一天一次
// 事件两种, 拓扑一样 (#165): 等来的 (人发的消息, 按发送时间) 与去找的 (信息流条目, 按原帖时间 at)
const SCAN_BATCH = 200;
// 最多往回翻这么多页, 消息再多的群也只读有限行
const SCAN_PAGES = 20;
const MAX_INTERVAL_MIN = 1440;
const PCT_MAX = 100;
// nextRuns 一次最多给这么多个, 每分钟一次也够数一天
const RUNS_MAX = 1000;
const ERR_QUOTA = "poolUsed, poolReset, dailyUsed 要么都给 (百分比 0-100 与 ISO 时间), 要么都不给";

/** 信息流条目的原帖时间: 只算写了 at 的 (没写时是推送时间, 跟着定时走, 会自我强化), 同一条只算一次。 */
function feedTimes(ev: Envelope, since: number, seen: Set<string>): number[] {
  if (ev.deleted || ev.kind !== "event") return [];
  const out: number[] = [];
  for (const it of ev.data.feed?.items ?? []) {
    const id = it.id ?? it.url ?? it.title;
    if (it.at === undefined || it.at < since || seen.has(id)) continue;
    seen.add(id);
    out.push(it.at);
  }
  return out;
}

/** 本群事件到达的时刻 (只看最近 PLAN_HISTORY_DAYS 天) 与实际覆盖的天数。 */
export function arrivalTimes(core: Core, channel: string, now: number): { times: number[]; days: number } {
  const since = now - PLAN_HISTORY_DAYS * DAY_MS;
  const times: number[] = [];
  const seen = new Set<string>();
  let before = core.store.head() + 1;
  let oldest = now;
  for (let page = 0; page < SCAN_PAGES; page++) {
    const batch = core.store.groupBefore(channel, before, SCAN_BATCH);
    for (const ev of batch) {
      oldest = Math.min(oldest, ev.ts);
      if (ev.ts >= since && isHuman(ev)) times.push(ev.ts);
      times.push(...feedTimes(ev, since, seen));
    }
    const first = batch[0];
    if (batch.length < SCAN_BATCH || !first || first.ts < since) break;
    before = first.seq;
  }
  return { times, days: Math.min(PLAN_HISTORY_DAYS, (now - Math.max(oldest, since)) / DAY_MS) };
}

/** 现有定时一天触发几次; 没上报或看不懂返回 undefined。 */
function perDayOf(t: AgentTrigger | undefined, now: number, tz: string): number | undefined {
  if (!t) return undefined;
  const n = nextRuns(t.expr, now, RUNS_MAX, tz, t.at).filter((x) => x < now + DAY_MS).length;
  return n || undefined;
}

const pct = (v: unknown) => (typeof v === "number" && v >= 0 && v <= PCT_MAX ? v : undefined);

function parseInput(raw: unknown, now: number): { quota?: PlanQuota; minInterval: number } | string {
  const r = (raw ?? {}) as AgentPlanInput;
  const mi = r.minInterval === undefined ? PLAN_MIN_INTERVAL_MIN : r.minInterval;
  if (!Number.isInteger(mi) || mi < 1 || mi > MAX_INTERVAL_MIN) return `minInterval 必须是 1-${MAX_INTERVAL_MIN} 的整数 (分钟)`;
  const given = [r.poolUsed, r.poolReset, r.dailyUsed].filter((x) => x !== undefined).length;
  if (!given) return { minInterval: mi };
  const poolUsed = pct(r.poolUsed);
  const dailyUsed = pct(r.dailyUsed);
  const poolReset = typeof r.poolReset === "string" ? Date.parse(r.poolReset) : Number.NaN;
  if (given !== 3 || poolUsed === undefined || dailyUsed === undefined || !Number.isFinite(poolReset)) return ERR_QUOTA;
  return { quota: { poolUsed, dailyUsed, poolReset: Math.max(poolReset, now) }, minInterval: mi };
}

export async function plan(c: ReqCtx): Promise<Response> {
  const { channel, agent } = agentByKey(c);
  const now = Date.now();
  const input = parseInput(await readJson(c.req), now);
  if (typeof input === "string") return fail(400, input);
  touchAgent(c.core, agent.keyId);
  const tz = agent.trigger?.tz && isTimeZone(agent.trigger.tz) ? agent.trigger.tz : PLAN_DEFAULT_TZ;
  const { times, days } = arrivalTimes(c.core, channel, now);
  const { result, state } = planSchedule({
    hourly: hourlyOf(times, tz),
    days,
    ...(input.quota ? { quota: input.quota } : {}),
    ...(agent.plan ? { prev: agent.plan } : {}),
    currentPerDay: perDayOf(agent.trigger, now, tz),
    minInterval: input.minInterval,
    now,
    tz,
  });
  putAgent(c.core, channel, agent.keyId, (a) => ({ ...a, plan: state }));
  return json(result);
}
