import { PATH_AGENT_ME, PATH_CHAT_TYPING, USER_SOURCE_PREFIX, globMatch, type ChatAgentMe, type KeyInfo } from "@hx-aioa/protocol";
import { canRead } from "./api-chats";
import { CODE_FORBIDDEN, ERR_FORBIDDEN, GET, HISTORY_MAX_LIMIT, OWNER_NAME, POST } from "./constants";
import { type Core, type Principal, ROOM, type ReqCtx, type Route, route } from "./core";
import { fail, json } from "./http";
import { type Attachment, sendFrame } from "./sockets";

const READ_SCOPE = "events:read";

/** key 对应的群 Agent: 名字以群资料里的为准 (改名即时生效), 找不到就用 key 名。 */
export function agentMe(core: Core, key: KeyInfo): ChatAgentMe {
  for (const meta of core.chats.chats()) {
    const a = meta.agents?.find((x) => x.keyId === key.id);
    if (a) return { keyId: key.id, name: a.name, channel: meta.channel, sourceId: a.sourceId, reads: key.channels };
  }
  return { keyId: key.id, name: key.name, reads: key.channels, ...(key.sourceId ? { sourceId: key.sourceId } : {}) };
}

/** HTTP 拉群消息的是 Agent 时记一次 "在监听"。 */
export function notePoll(core: Core, who: Principal, channel: string): void {
  if (who.owner || who.member) return;
  core.presence.polled(channel, who.key.id, agentMe(core, who.key).name);
}

/** CLI 长连 (role=chat): 只有带读权限的 key; 主人用访问令牌连时读全部。 */
export function mayListen(who: Principal): boolean {
  return who.owner || (!who.member && who.key.scopes.includes(READ_SCOPE));
}

/** CLI 长连接上: 记下能读的群与名字, 返回给 welcome 的身份。 */
export function chatConnected(core: Core, ws: WebSocket, att: Attachment, who: Principal): ChatAgentMe {
  const me: ChatAgentMe = who.owner ? { keyId: "", name: OWNER_NAME, reads: ["*"] } : agentMe(core, who.key);
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
