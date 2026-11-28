import { PATH_EVENTS, QUERY_KIND, QUERY_LIMIT, QUERY_SINCE, type Envelope } from "@hx-aioa/protocol";
import { api } from "./auth";

// 总览 "你和 Agent 一起" (对照安卓 OverviewPulse / OverviewPulseMath): 今天按小时, 本周按天 (周一起)
export type PulseSpan = "day" | "week";
export type PulseRow = { label: string; mine: number; agent: number; done: number };
export type PulseData = { rows: PulseRow[]; peak?: { label: string; count: number }; mine: number; agent: number; done: number };
export type Lifetime = { perDay: Map<string, number>; total: number; agent: number };

const PAGE = 500;
// 往前最多看这么多条事件, 够算一周与连续活跃; 只在打开总览时取一次
const BACK = 3000;
const HOURS = 24;
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DAY_MS = 86_400_000;

export async function recentEvents(head: number): Promise<Envelope[]> {
  const out: Envelope[] = [];
  let since = Math.max(0, head - BACK);
  for (;;) {
    const r = await api<{ events: Envelope[] }>(`${PATH_EVENTS}?${QUERY_SINCE}=${since}&${QUERY_LIMIT}=${PAGE}&${QUERY_KIND}=event`);
    const got = r?.events ?? [];
    out.push(...got);
    if (got.length < PAGE) return out;
    since = got[got.length - 1]!.seq;
  }
}

export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function spanStart(span: PulseSpan, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (span === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// mine: 我发的; agent: 群 Agent 发的 (按来源 id); doneAt: 完成待办的时刻; 当前格之后不出值
export function buildPulse(span: PulseSpan, events: Envelope[], me: string, agentSids: Set<string>, doneAt: number[], now = Date.now()): PulseData {
  const from = spanStart(span, now);
  const slot = (ts: number) => (ts < from ? -1 : span === "day" ? Math.floor((ts - from) / 3_600_000) : Math.floor((ts - from) / DAY_MS));
  const n = span === "day" ? HOURS : WEEKDAYS.length;
  const cur = Math.min(n - 1, slot(now));
  const rows: PulseRow[] = Array.from({ length: cur + 1 }, (_, i) => ({ label: span === "day" ? `${String(i).padStart(2, "0")}:00` : WEEKDAYS[i]!, mine: 0, agent: 0, done: 0 }));
  for (const ev of events) {
    const i = slot(ev.ts);
    if (i < 0 || i > cur) continue;
    if (ev.by === me) rows[i]!.mine++;
    else if (agentSids.has(ev.source.id)) rows[i]!.agent++;
  }
  for (const t of doneAt) {
    const i = slot(t);
    if (i >= 0 && i <= cur) rows[i]!.done++;
  }
  let peak: PulseData["peak"];
  for (const r of rows) if (r.mine + r.agent > (peak?.count ?? 0)) peak = { label: r.label, count: r.mine + r.agent };
  const sum = (k: "mine" | "agent" | "done") => rows.reduce((a, r) => a + r[k], 0);
  return { rows, peak, mine: sum("mine"), agent: sum("agent"), done: sum("done") };
}

export function lifetime(events: Envelope[], me: string, agentSids: Set<string>): Lifetime {
  const perDay = new Map<string, number>();
  let total = 0;
  let agent = 0;
  for (const ev of events) {
    const a = agentSids.has(ev.source.id);
    if (ev.by !== me && !a) continue;
    total++;
    if (a) agent++;
    const k = dayKey(ev.ts);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  return { perDay, total, agent };
}

// 到今天为止连续有消息的天数; 今天还没有就从昨天往前数
export function streakOf(perDay: Map<string, number>, now = Date.now()): number {
  let t = now;
  if (!perDay.get(dayKey(t))) t -= DAY_MS;
  let n = 0;
  while (perDay.get(dayKey(t))) {
    n++;
    t -= DAY_MS;
  }
  return n;
}
