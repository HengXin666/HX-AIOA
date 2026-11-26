import { HANDLED_SET_MAX, NEXT_LIMIT, SOURCE_TYPE_USER, type ChatAgent, type Envelope } from "@hx-aioa/protocol";
import type { Core } from "./core";

// 云 Agent 的处理游标 (docs/design/agent-skill.md 实现契约): handled 之前的人发消息都处理过, handledSet 是之后零散处理过的
const SYSTEM_PREFIX = "system:";
const SCAN_BATCH = 200;
// 数 "还剩几条" 时最多数到这里
export const LEFT_MAX = 999;
export type Cursor = { handled: number; handledSet: number[] };

/** 人发的消息: App 里发的带 user 类型, 主人令牌直接发的不带类型; Agent, 脚本, 系统消息都不算 (与命令行 watch 一致)。 */
export function isHuman(ev: Envelope): boolean {
  if (ev.deleted || ev.kind !== "event") return false;
  if (ev.source.id.startsWith(SYSTEM_PREFIX)) return false;
  return !ev.source.type || ev.source.type === SOURCE_TYPE_USER;
}

/** 游标之后没处理过的人发消息, 按 seq 升序, 最多 limit 条。 */
export function pendingOf(core: Core, channel: string, cur: Cursor, limit = NEXT_LIMIT): Envelope[] {
  const skip = new Set(cur.handledSet);
  const out: Envelope[] = [];
  let after = cur.handled;
  for (;;) {
    const batch = core.store.inChannel(channel, after, SCAN_BATCH);
    for (const ev of batch) {
      if (!isHuman(ev) || skip.has(ev.seq)) continue;
      out.push(ev);
      if (out.length >= limit) return out;
    }
    const last = batch.at(-1);
    if (batch.length < SCAN_BATCH || !last) return out;
    after = last.seq;
  }
}

/** 老 Agent 第一次用: 它在本群最后一条消息; 没发过就取接入前最后一条; 都没有为 0。 */
export function initialHandled(core: Core, channel: string, agent: ChatAgent): number {
  return core.store.lastBy(channel, agent.sourceId) ?? core.store.lastBefore(channel, agent.joined ?? agent.created) ?? 0;
}

export function cursorOf(core: Core, channel: string, agent: ChatAgent): Cursor {
  return { handled: agent.handled ?? initialHandled(core, channel, agent), handledSet: agent.handledSet ?? [] };
}

/**
 * 把 seqs 记为已处理再推进游标: 人发消息必须在集合里才能越过, Agent 与系统消息直接越过 (回复不会留在集合里);
 * 集合超过上限时直接推到其中最小那段连续值之后。
 */
export function advance(core: Core, channel: string, cur: Cursor, seqs: number[]): Cursor {
  let handled = cur.handled;
  const set = new Set([...cur.handledSet, ...seqs].filter((s) => s > handled));
  while (set.size > HANDLED_SET_MAX) {
    let end = Math.min(...set);
    while (set.has(end + 1)) end += 1;
    handled = end;
    for (const s of set) if (s <= end) set.delete(s);
  }
  for (let more = true; more; ) {
    const batch = core.store.inChannel(channel, handled, SCAN_BATCH);
    more = batch.length === SCAN_BATCH;
    for (const ev of batch) {
      if (isHuman(ev) && !set.has(ev.seq)) {
        more = false;
        break;
      }
      handled = ev.seq;
      set.delete(ev.seq);
    }
  }
  return { handled, handledSet: [...set].filter((s) => s > handled).sort((a, b) => a - b) };
}

export const sameCursor = (a: Cursor, b: Cursor) => a.handled === b.handled && a.handledSet.join() === b.handledSet.join();

const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, 秒: 1, 分: 60, 分钟: 60, 时: 3600, 小时: 3600, 天: 86_400 };
const STEP = /^\*\/(\d+)$/;
const NUM = /^\d+$/;
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : undefined);

/** 定时表达式推算间隔秒数: every 2h, 每 2 小时, 分钟或小时步进的 cron, 纯数字秒; 看不懂返回 undefined。 */
export function parseEvery(expr: string): number | undefined {
  const t = expr.trim();
  if (NUM.test(t)) return pos(Number(t));
  const en = /^every\s+(\d+)\s*([smhd])[a-z]*$/i.exec(t);
  if (en) return pos(Number(en[1]) * (UNIT[(en[2] ?? "").toLowerCase()] ?? 0));
  const zh = /^每\s*(\d*)\s*(秒|分钟|分|小时|时|天)$/.exec(t);
  if (zh) return pos((zh[1] ? Number(zh[1]) : 1) * (UNIT[zh[2] ?? ""] ?? 0));
  const f = t.split(/\s+/);
  if (f.length !== 5 || !f.slice(2).every((x) => x === "*")) return undefined;
  const [mi = "", ho = ""] = f;
  const m = STEP.exec(mi);
  if (m && ho === "*") return pos(Number(m[1]) * UNIT.m!);
  const h = STEP.exec(ho);
  if (h && NUM.test(mi)) return pos(Number(h[1]) * UNIT.h!);
  return undefined;
}
