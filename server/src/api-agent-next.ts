import {
  AGENT_TRIGGER_MAX,
  PATH_AGENT_PLAN,
  PLAN_DEFAULT_TZ,
  replanDue,
  HANDLED_SET_MAX,
  HEADER_SKILL,
  MENTION_AGENT_PREFIX,
  MENTION_ALL,
  PATH_AGENT_DONE,
  PATH_AGENT_NEXT,
  PATH_AGENT_TRIGGER,
  TRIGGER_TZ_MAX,
  isTimeZone,
  parseSkillHeader,
  type AgentDoneResult,
  type AgentNext,
  type AgentTrigger,
  type ChatAgent,
  type Envelope,
  type Scope,
} from "@hx-aioa/protocol";
import { LEFT_MAX, advance, cursorOf, parseEvery, pendingOf, sameCursor, type Cursor } from "./agent-cursor";
import { agentOfKey } from "./agent-sync";
import { briefOf, expiredOf, putAgent } from "./agent-want";
import { agentByKey } from "./api-chats";
import { notePoll, touchAgent } from "./api-presence";
import { CODE_SKILL_EXPIRED, FLAG_ON, GET, POST, QUERY_BRIEF, QUERY_MEMORY, QUERY_START } from "./constants";
import { type Core, type Principal, type ReqCtx, type Route, route } from "./core";
import { fail, json, readJson } from "./http";
import { plan } from "./api-agent-plan";

// 云 Agent 一轮的服务端接口 (docs/design/agent-skill.md 实现契约): next, done, trigger, 以及 POST /messages 的 covers
const SEND_SCOPE: Scope = "messages:send";
const ERR_SEQS = `seqs 必须是正整数数组, 最多 ${HANDLED_SET_MAX} 个`;

const withCursor = (a: ChatAgent, c: Cursor): ChatAgent => {
  const { handledSet: _s, ...rest } = a;
  return { ...rest, handled: c.handled, ...(c.handledSet.length ? { handledSet: c.handledSet } : {}) };
};

// 消息 @ 了这个 Agent 或全体 (#131)
const mentions = (ev: Envelope, keyId: string) => (ev.mentions ?? []).some((m) => m === MENTION_ALL || m === MENTION_AGENT_PREFIX + keyId);

async function next(c: ReqCtx): Promise<Response> {
  const { channel, agent } = agentByKey(c);
  const now = Date.now();
  const have = parseSkillHeader(c.req.headers.get(HEADER_SKILL)) ?? agent.skills;
  const dead = expiredOf(c.core, agent, have, now);
  if (dead) return fail(409, `${dead.version} 大版本的兼容期已在 ${dead.until} 结束: 不要自己安装, 在群里告诉主人重新接入`, CODE_SKILL_EXPIRED);
  notePoll(c.core, c.who, channel);
  const q = c.url.searchParams;
  const cur = cursorOf(c.core, channel, agent);
  const start = q.get(QUERY_START) === FLAG_ON;
  // 游标第一次初始化, 本轮开始时间与重算后的触发次数合成一次写
  if (agent.handled === undefined || start) {
    putAgent(c.core, channel, agent.keyId, (a) => ({
      ...(a.handled === undefined ? withCursor(a, cur) : a),
      ...(start ? { lastRun: now, ...(a.plan ? { plan: { ...a.plan, runs: a.plan.runs + 1 } } : {}) } : {}),
    }));
  }
  const meta = c.core.chats.chat(channel);
  const fresh = meta?.agents?.find((a) => a.keyId === agent.keyId) ?? agent;
  const brief = meta ? briefOf(c.core, meta, fresh, have, now) : null;
  const body: AgentNext = {
    pending: pendingOf(c.core, channel, cur).map((ev) => (mentions(ev, agent.keyId) ? { ...ev, mentioned: true as const } : ev)),
    head: c.core.store.head(),
    cursor: cur.handled,
    briefVersion: brief?.version ?? "",
    ...(brief && q.get(QUERY_BRIEF) !== brief.version ? { brief } : {}),
    ...(q.get(QUERY_MEMORY) === FLAG_ON ? { memory: c.core.chats.memory(agent.sourceId).text } : {}),
    ...(fresh.trigger && replanDue(fresh.plan?.at, now, fresh.trigger.tz ?? PLAN_DEFAULT_TZ) ? { replan: true as const } : {}),
  };
  return json(body);
}

function parseSeqs(raw: unknown): number[] | string {
  if (!Array.isArray(raw) || raw.length > HANDLED_SET_MAX || !raw.every((s) => Number.isSafeInteger(s) && s > 0)) return ERR_SEQS;
  return raw as number[];
}

/** 记为已处理并推进游标; 游标与集合只在变化时写。超过当前 head 的 seq 不收。 */
export function markDone(core: Core, channel: string, keyId: string, seqs: number[]): AgentDoneResult {
  const agent = core.chats.chat(channel)?.agents?.find((a) => a.keyId === keyId);
  if (!agent) return { cursor: 0, left: 0 };
  const head = core.store.head();
  const from = cursorOf(core, channel, agent);
  const to = advance(core, channel, from, seqs.filter((s) => s <= head));
  if (agent.handled === undefined || !sameCursor(from, to)) putAgent(core, channel, keyId, (a) => withCursor(a, to));
  return { cursor: to.handled, left: pendingOf(core, channel, to, LEFT_MAX).length };
}

async function done(c: ReqCtx): Promise<Response> {
  const { channel, agent } = agentByKey(c);
  const seqs = parseSeqs(((await readJson(c.req)) as { seqs?: unknown } | undefined)?.seqs);
  if (typeof seqs === "string") return fail(400, seqs);
  touchAgent(c.core, agent.keyId);
  return json(markDone(c.core, channel, agent.keyId, seqs));
}

async function trigger(c: ReqCtx): Promise<Response> {
  const { channel, agent } = agentByKey(c);
  const raw = (await readJson(c.req)) as { expr?: unknown; tz?: unknown } | undefined;
  const expr = typeof raw?.expr === "string" ? raw.expr.trim() : "";
  if (!expr || expr.length > AGENT_TRIGGER_MAX) return fail(400, `需要 {"expr": "定时表达式"}, 最多 ${AGENT_TRIGGER_MAX} 字`);
  const tz = raw?.tz === undefined || raw.tz === "" ? agent.trigger?.tz : raw.tz;
  if (tz !== undefined && (typeof tz !== "string" || !isTimeZone(tz))) return fail(400, `tz 必须是 IANA 时区名, 如 Asia/Shanghai, 最多 ${TRIGGER_TZ_MAX} 字`);
  touchAgent(c.core, agent.keyId);
  if (agent.trigger?.expr === expr && agent.trigger.tz === tz) return json({ trigger: agent.trigger });
  // cron 与间隔写法都按原样记下; every 只给旧客户端推算用
  const every = parseEvery(expr);
  const t: AgentTrigger = { expr, ...(every ? { every } : {}), at: Date.now(), ...(tz ? { tz } : {}) };
  putAgent(c.core, channel, agent.keyId, (a) => ({ ...a, trigger: t }));
  return json({ trigger: t });
}

/** POST /messages 的 covers: 发送前校验 (只给群 Agent), 返回要记的 seq 或错误文字。 */
export function coversOf(core: Core, who: Principal, raw: unknown): { channel: string; keyId: string; seqs: number[] } | string | null {
  if (raw === undefined) return null;
  const hit = who.owner ? null : agentOfKey(core, who.key.id);
  if (!hit) return "covers 只给群里接入的 Agent 用";
  const seqs = parseSeqs(raw);
  return typeof seqs === "string" ? `covers: ${seqs}` : { channel: hit.meta.channel, keyId: hit.agent.keyId, seqs };
}

export const AGENT_NEXT_ROUTES: Route[] = [
  route(GET, PATH_AGENT_NEXT, SEND_SCOPE, next),
  route(POST, PATH_AGENT_DONE, SEND_SCOPE, done),
  route(POST, PATH_AGENT_TRIGGER, SEND_SCOPE, trigger),
  route(POST, PATH_AGENT_PLAN, SEND_SCOPE, plan),
];
