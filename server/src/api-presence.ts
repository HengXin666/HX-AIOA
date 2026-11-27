import { AGENT_ACTIVE_FLUSH_MS, AGENT_ACTIVE_STEP_MS, PATH_AGENT_ME, PATH_CHAT_TYPING, USER_SOURCE_PREFIX, globMatch, type ChatAgentMe, type KeyInfo } from "@hx-aioa/protocol";
import { canRead } from "./api-chats";
import { pushActive } from "./chat-sync";
import { CODE_FORBIDDEN, ERR_FORBIDDEN, GET, HISTORY_MAX_LIMIT, OWNER_NAME, POST } from "./constants";
import { type Core, type Principal, ROOM, type ReqCtx, type Route, route } from "./core";
import { fail, json } from "./http";
import { type Attachment, sendFrame } from "./sockets";

const READ_SCOPE = "events:read";

/** key 对应的群 Agent: 名字以群资料里的为准 (改名即时生效), 找不到就用 key 名。 */
export function agentMe(core: Core, key: KeyInfo): ChatAgentMe {
  const hit = core.chats.byKey(key.id);
  if (hit) return { keyId: key.id, name: hit.agent.name, channel: hit.meta.channel, sourceId: hit.agent.sourceId, reads: key.channels };
  return { keyId: key.id, name: key.name, reads: key.channels, ...(key.sourceId ? { sourceId: key.sourceId } : {}) };
}

function saveActive(core: Core, keyId: string, at: number): void {
  const hit = core.chats.byKey(keyId);
  if (!hit || (hit.agent.active ?? 0) >= at) return;
  core.chats.replaceChat({ ...hit.meta, agents: (hit.meta.agents ?? []).map((x) => (x.keyId === keyId ? { ...x, active: at } : x)) });
}

/**
 * Agent 有动作 (拉消息, 发消息, 拉指令, 长连): 活跃时间记在内存, 每 2 分钟最多推一帧 agent_active 给主人;
 * 库里的值比现在早 30 分钟以上才落一次库 (#129), 不再整份重写群资料也不让各端重拉。
 */
export function touchAgent(core: Core, keyId: string, now = Date.now()): void {
  const hit = core.chats.byKey(keyId);
  if (!hit) return;
  const saved = hit.agent.active ?? 0;
  if (now - Math.max(saved, core.chats.active.get(keyId) ?? 0) < AGENT_ACTIVE_STEP_MS) return;
  core.chats.active.set(keyId, now);
  pushActive(core, hit.meta.channel, keyId, now);
  if (now - saved >= AGENT_ACTIVE_FLUSH_MS) saveActive(core, keyId, now);
}

/** 每 30 分钟的 cron: 把内存里较新的活跃时间落库, 返回写了几个。 */
export function flushActive(core: Core): number {
  let n = 0;
  for (const [keyId, at] of core.chats.active) {
    if (at <= (core.chats.byKey(keyId)?.agent.active ?? at)) continue;
    saveActive(core, keyId, at);
    n += 1;
  }
  return n;
}

/** HTTP 拉群消息的是 Agent 时记一次 "在监听"。 */
export function notePoll(core: Core, who: Principal, channel: string): void {
  if (who.owner || who.member) return;
  core.presence.polled(channel, who.key.id, agentMe(core, who.key).name);
  touchAgent(core, who.key.id);
}

/** CLI 长连 (role=chat): 只有带读权限的 key; 主人用访问令牌连时读全部。 */
export function mayListen(who: Principal): boolean {
  return who.owner || (!who.member && who.key.scopes.includes(READ_SCOPE));
}

/** CLI 长连接上: 记下能读的群与名字, 返回给 welcome 的身份。 */
export function chatConnected(core: Core, ws: WebSocket, att: Attachment, who: Principal): ChatAgentMe {
  const me: ChatAgentMe = who.owner ? { keyId: "", name: OWNER_NAME, reads: ["*"] } : agentMe(core, who.key);
  if (!who.owner) touchAgent(core, who.key.id);
  att.reads = me.reads;
  att.name = me.name;
  ws.serializeAttachment(att);
  return me;
}

/** welcome 之后补发 since 之后能读的群消息。 */
export function chatBacklog(core: Core, ws: WebSocket, who: Principal, since: number): void {
  if (!Number.isFinite(since)) return;
  for (const ev of core.store.since(since, HISTORY_MAX_LIMIT)) {
    const ch = ev.channel;
    if (ch && canRead(core, who, ch)) sendFrame(ws, { t: "ev", ev });
  }
}

/** 长连接上的 typing 帧: 人按账号, CLI 按 key。 */
export function typingFrom(core: Core, att: Attachment, channel: string): void {
  if (att.role === "chat") {
    if (att.keyId && (att.reads ?? []).some((p) => globMatch(p, channel))) core.presence.typed(channel, att.keyId, att.name ?? att.keyId);
    return;
  }
  if (att.role !== "client") return;
  if (att.member && !(att.uid && core.rooms.member(channel, att.uid))) return;
  const user = att.uid ? core.users.get(att.uid) : undefined;
  const id = att.uid ? USER_SOURCE_PREFIX + att.uid : att.device;
  core.presence.typed(channel, id, user?.display || user?.name || OWNER_NAME);
}

// Agent 用 HTTP 报 "正在输入" (CLI 的 typing 命令); 人走长连接
function postTyping(c: ReqCtx): Response {
  const channel = decodeURIComponent(c.params[0] ?? "");
  if (c.who.owner || c.who.member || !canRead(c.core, c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  c.core.presence.typed(channel, c.who.key.id, agentMe(c.core, c.who.key).name);
  return json({ ok: true });
}

function getMe(c: ReqCtx): Response {
  if (c.who.owner || c.who.member) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  return json({ me: agentMe(c.core, c.who.key) });
}

export const PRESENCE_ROUTES: Route[] = [route(POST, PATH_CHAT_TYPING, ROOM, postTyping), route(GET, PATH_AGENT_ME, ROOM, getMe)];
