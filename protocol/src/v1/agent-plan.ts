import { API_V1 } from "./constants";

// 云 Agent 的自适应定时 (#161): 只能被定时叫醒的宿主, 按群里人发消息的时段分布与剩余额度算出新的 cron
// 纯函数, 服务端算, 命令行与各端只展示; 换业务只换事件来源, 算法不动

export const PATH_AGENT_PLAN = `${API_V1}/chat-agent/plan`;
// 每天这个钟点 (宿主时区) 之后第一次触发时要求重算
export const PLAN_REPLAN_HOUR = 3;
export const PLAN_HISTORY_DAYS = 14;
export const PLAN_BOOTSTRAP_DAYS = 7;
export const PLAN_BOOTSTRAP_EVENTS = 10;
// 多数定时宿主的最短间隔
export const PLAN_MIN_INTERVAL_MIN = 10;
export const PLAN_RESERVE = 0.1;
export const PLAN_COST_SAMPLES = 14;
// 还没有样本时的单次成本估计 (总额度的百分比)
export const PLAN_DEFAULT_COST = 0.5;
export const PLAN_MIN_COST = 0.01;
export const PLAN_DEFAULT_TZ = "Asia/Shanghai";
const HOURS = 24;
const MIN_PER_HOUR = 60;
const DAY_MS = 86_400_000;
// 没见过消息的时段也保底分到一点
const SMOOTH = 0.05;
const ALL = "*";

// 存在 ChatAgent.plan: 上次重算的时刻, 之后的触发次数, 当时的总额度已用%, 单次成本样本
export type AgentPlanState = { at: number; runs: number; poolUsed?: number; costs?: number[] };
// POST plan: 额度三项拿不到就都不写, 这时保持现有每天次数, 只按时段重新分配
export type AgentPlanInput = { poolUsed?: number; poolReset?: string; dailyUsed?: number; minInterval?: number };
export type AgentPlanResult = {
  mode: "bootstrap" | "fitted";
  budget: "quota" | "keep";
  cost?: number;
  runsPerDay: number;
  perHour: number[];
  cron: string[];
  single: string;
  peakHour: number;
  peakIntervalMin?: number;
  daysUntilReset?: number;
  events: number;
  days: number;
  tz: string;
};
export type PlanQuota = { poolUsed: number; poolReset: number; dailyUsed: number };
export type PlanArgs = {
  hourly: number[];
  days: number;
  quota?: PlanQuota;
  prev?: AgentPlanState;
  currentPerDay?: number;
  minInterval?: number;
  now: number;
  tz: string;
};

const FORMATS = new Map<string, Intl.DateTimeFormat>();

/** 某时刻在 tz 的日期 (YYYY-MM-DD) 与钟点。 */
export function wallDay(ms: number, tz: string): { day: string; hour: number } {
  let f = FORMATS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" });
    FORMATS.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(ms)) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % HOURS };
}

/** 今天过了重算钟点, 且上次重算不在今天。 */
export function replanDue(planAt: number | undefined, now: number, tz: string): boolean {
  const w = wallDay(now, tz);
  if (w.hour < PLAN_REPLAN_HOUR) return false;
  return planAt === undefined || wallDay(planAt, tz).day < w.day;
}

/** 事件时刻按 tz 的钟点计数。 */
export function hourlyOf(times: number[], tz: string): number[] {
  const out = new Array<number>(HOURS).fill(0);
  for (const t of times) out[wallDay(t, tz).hour]! += 1;
  return out;
}

/** 总次数固定时, 各小时次数 ∝ sqrt(到达率) 使平均等待最短; 最大余数取整, 单小时不超过 cap。 */
export function sqrtAllocate(rates: number[], total: number, cap: number): number[] {
  const w = rates.map((r) => Math.sqrt(Math.max(0, r) + SMOOTH));
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (total * x) / sum);
  const alloc = raw.map((x) => Math.min(cap, Math.floor(x)));
  for (let left = total - alloc.reduce((a, b) => a + b, 0); left > 0; left--) {
    let best = -1;
    for (let h = 0; h < HOURS; h++) if (alloc[h]! < cap && (best < 0 || raw[h]! - alloc[h]! > raw[best]! - alloc[best]!)) best = h;
    if (best < 0) break;
    alloc[best]! += 1;
  }
  return alloc;
}

/** 均匀撒开: 先每小时平分, 余下的隔开放。 */
export function uniformAllocate(total: number, cap: number): number[] {
  const base = Math.min(cap, Math.floor(total / HOURS));
  const alloc = new Array<number>(HOURS).fill(base);
  const rem = base === cap ? 0 : total - base * HOURS;
  for (let i = 0; i < rem; i++) alloc[Math.floor((i * HOURS) / rem)]! += 1;
  return alloc;
}

const minutes = (n: number) => Array.from({ length: n }, (_, i) => i * Math.floor(MIN_PER_HOUR / n)).join(",");
const hoursField = (hours: number[]) => (hours.length === HOURS ? ALL : hours.join(","));

/** 每小时次数变成 cron: 同次数的小时合并成一行。 */
export function cronLines(alloc: number[]): string[] {
  const groups = new Map<number, number[]>();
  alloc.forEach((n, h) => n > 0 && groups.set(n, [...(groups.get(n) ?? []), h]));
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([n, hours]) => `${minutes(n)} ${hoursField(hours)} * * *`);
}

/** 宿主只收一条表达式时的近似: 有触发的小时, 每小时取平均次数。 */
export function singleCron(alloc: number[], cap: number): string {
  const hours = alloc.flatMap((n, h) => (n > 0 ? [h] : []));
  if (!hours.length) return `0 ${PLAN_REPLAN_HOUR} * * *`;
  const total = alloc.reduce((a, b) => a + b, 0);
  const n = Math.min(cap, Math.max(1, Math.round(total / hours.length)));
  return `${minutes(n)} ${hoursField(hours)} * * *`;
}

/** 单次成本: 两次重算之间总额度涨幅 / 期间触发次数; 额度重置过 (涨幅为负) 的不算。 */
function costSamples(prev: AgentPlanState | undefined, quota: PlanQuota | undefined): number[] {
  const old = prev?.costs ?? [];
  if (!quota || prev?.poolUsed === undefined || !prev.runs) return old;
  const d = quota.poolUsed - prev.poolUsed;
  return d >= 0 ? [...old, d / prev.runs].slice(-PLAN_COST_SAMPLES) : old;
}

export function planSchedule(a: PlanArgs): { result: AgentPlanResult; state: AgentPlanState } {
  const cap = Math.max(1, Math.floor(MIN_PER_HOUR / Math.max(1, a.minInterval ?? PLAN_MIN_INTERVAL_MIN)));
  const costs = costSamples(a.prev, a.quota);
  const cost = Math.max(PLAN_MIN_COST, costs.length ? costs.reduce((x, y) => x + y, 0) / costs.length : PLAN_DEFAULT_COST);
  let perDay: number;
  let daysLeft: number | undefined;
  if (a.quota) {
    daysLeft = Math.max((a.quota.poolReset - a.now) / DAY_MS, 0.5);
    const pool = ((100 - a.quota.poolUsed) * (1 - PLAN_RESERVE)) / cost / daysLeft;
    const daily = ((100 - a.quota.dailyUsed) * (1 - PLAN_RESERVE)) / cost;
    perDay = Math.floor(Math.max(1, Math.min(pool, daily)));
  } else perDay = Math.max(1, a.currentPerDay ?? HOURS);
  perDay = Math.min(perDay, cap * HOURS);
  const events = a.hourly.reduce((x, y) => x + y, 0);
  const fitted = a.days >= PLAN_BOOTSTRAP_DAYS && events >= PLAN_BOOTSTRAP_EVENTS;
  const days = Math.max(a.days, 1);
  const alloc = fitted ? sqrtAllocate(a.hourly.map((n) => n / days), perDay, cap) : uniformAllocate(perDay, cap);
  const peakHour = alloc.reduce((best, n, h) => (n > alloc[best]! ? h : best), 0);
  const result: AgentPlanResult = {
    mode: fitted ? "fitted" : "bootstrap",
    budget: a.quota ? "quota" : "keep",
    ...(a.quota ? { cost: Math.round(cost * 1000) / 1000, daysUntilReset: Math.round(daysLeft! * 10) / 10 } : {}),
    runsPerDay: alloc.reduce((x, y) => x + y, 0),
    perHour: alloc,
    cron: cronLines(alloc),
    single: singleCron(alloc, cap),
    peakHour,
    ...(alloc[peakHour] ? { peakIntervalMin: Math.floor(MIN_PER_HOUR / alloc[peakHour]!) } : {}),
    events,
    days: Math.round(a.days * 10) / 10,
    tz: a.tz,
  };
  const state: AgentPlanState = { at: a.now, runs: 0, ...(a.quota ? { poolUsed: a.quota.poolUsed } : {}), ...(costs.length ? { costs } : {}) };
  return { result, state };
}
