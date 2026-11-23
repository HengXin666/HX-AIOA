import {
  APP_SCHEME,
  MAX_ID_LENGTH,
  PATH_CHAT_INVITES,
  PATH_CHAT_MEMBER,
  PATH_CHAT_MEMBERS,
  PATH_JOIN_PAGE,
  PATH_ROOM_JOIN,
  QUERY_CODE,
  QUERY_SERVER,
  ROOM_INVITE_MAX_TTL_HOURS,
  ROOM_INVITE_MAX_USES,
  ROOM_INVITE_TTL_HOURS,
  type ChatSyncFrame,
  type RoomInviteCreated,
  type RoomJoined,
  type RoomMember,
  type UserPublic,
} from "@hx-aioa/protocol";
import { CODE_CONFLICT, CODE_EXPIRED, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, GET, PATCH, POST } from "./constants";
import { type Core, type ReqCtx, ROOM, type Route, route } from "./core";
import { ApiFail, clampInt, fail, json, readJson } from "./http";
import { memberView, mustRole, ownerView, rank } from "./room-access";

const HOUR_MS = 3600_000;
export const ERR_BAD_ROOM_INVITE = "邀请链接无效";
export const ERR_ROOM_INVITE_EXPIRED = "邀请链接已过期或已用完";
const ERR_NO_USER = "没有这个账号";
const ERR_NOT_MEMBER = "不在群里";

const param = (c: ReqCtx, i: number) => decodeURIComponent(c.params[i] ?? "");
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
export const baseOf = (u: URL) => (LOCAL_HOSTS.includes(u.hostname) ? u.origin : `https://${u.host}`);

// 成员或群资料变了: 让各端重新拉群列表
export function syncChats(core: Core, channel: string): void {
  core.sockets.toAllClients({ t: "chat_sync", topic: "chats", channel } satisfies ChatSyncFrame);
}

function brief(u: UserPublic): Pick<RoomMember, "id" | "name" | "display"> {
  return { id: u.id, name: u.name, display: u.display || u.name };
}

function listMembers(c: ReqCtx): Response {
  const grp = param(c, 0);
  mustRole(c.core, c.who, grp, "member");
  const owner = c.core.users.get(c.core.users.ownerId());
  const out: RoomMember[] = owner ? [{ ...brief(owner), role: "owner", joined: 0 }] : [];
  for (const m of c.core.rooms.members(grp)) {
    const u = c.core.users.get(m.member);
    if (u) out.push({ ...brief(u), role: m.role, joined: m.joined });
  }
  return json({ members: out });
}

// 直接拉已有账号进群 (群主 / 管理员)
async function addMember(c: ReqCtx): Promise<Response> {
  const grp = param(c, 0);
  if (!grp || grp.length > MAX_ID_LENGTH) return fail(400, "群名不合法");
  const mine = mustRole(c.core, c.who, grp, "admin");
  const body = ((await readJson(c.req)) ?? {}) as Record<string, unknown>;
  const u = typeof body.user === "string" ? c.core.users.find(body.user) : null;
  if (!u || u.status !== "active") return fail(404, ERR_NO_USER, CODE_NOT_FOUND);
  if (u.id === c.core.users.ownerId()) return fail(409, "群主已经在群里", CODE_CONFLICT);
  const role = body.role === "admin" && mine === "owner" ? "admin" : "member";
  c.core.rooms.add(grp, u.id, role);
  c.core.chats.patchChat(grp, {});
  syncChats(c.core, grp);
  return listMembers(c);
}

// 改身份只有群主能做; 踢人要比对方身份高; 自己可以退群
async function patchMember(c: ReqCtx): Promise<Response> {
  const grp = param(c, 0);
  mustRole(c.core, c.who, grp, "owner");
  const body = ((await readJson(c.req)) ?? {}) as Record<string, unknown>;
  const role = body.role === "admin" ? "admin" : "member";
  if (!c.core.rooms.setRole(grp, param(c, 1), role)) return fail(404, ERR_NOT_MEMBER, CODE_NOT_FOUND);
  c.core.chats.patchChat(grp, {});
  syncChats(c.core, grp);
  return listMembers(c);
}

function removeMember(c: ReqCtx): Response {
  const grp = param(c, 0);
  const uid = param(c, 1);
  const self = !c.who.owner && c.who.member?.user.id === uid;
  if (!self) {
    const mine = mustRole(c.core, c.who, grp, "admin");
    const target = c.core.rooms.member(grp, uid);
    if (!target) return fail(404, ERR_NOT_MEMBER, CODE_NOT_FOUND);
    if (rank(target.role) >= rank(mine)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  }
  if (!c.core.rooms.remove(grp, uid)) return fail(404, ERR_NOT_MEMBER, CODE_NOT_FOUND);
  c.core.chats.patchChat(grp, {});
  syncChats(c.core, grp);
  return json({ ok: true });
}

async function createInvite(c: ReqCtx): Promise<Response> {
  const grp = param(c, 0);
  if (!grp || grp.length > MAX_ID_LENGTH) return fail(400, "群名不合法");
  mustRole(c.core, c.who, grp, "admin");
  const body = ((await readJson(c.req)) ?? {}) as Record<string, unknown>;
  const hours = clampInt(String(body.ttlHours ?? ""), ROOM_INVITE_TTL_HOURS, ROOM_INVITE_MAX_TTL_HOURS);
  const maxUses = clampInt(String(body.maxUses ?? ""), ROOM_INVITE_MAX_USES, ROOM_INVITE_MAX_USES);
  const { code, expires } = await c.core.rooms.createInvite(grp, hours * HOUR_MS, maxUses);
  c.core.chats.patchChat(grp, {});
  const base = baseOf(c.url);
  const link = base + PATH_JOIN_PAGE.replace("{code}", code);
  const appLink = `${APP_SCHEME}://join?${QUERY_SERVER}=${encodeURIComponent(base)}&${QUERY_CODE}=${code}`;
  return json({ code, link, appLink, expires, maxUses } satisfies RoomInviteCreated);
}

/** 用邀请码进群, 已有账号直接加入; 返回群资料。新账号注册时也走这里。 */
export async function joinRoom(core: Core, uid: string, code: string): Promise<string> {
  const r = await core.rooms.checkInvite(code);
  if (r === "missing") throw new ApiFail(404, CODE_NOT_FOUND, ERR_BAD_ROOM_INVITE);
  if (r === "expired") throw new ApiFail(410, CODE_EXPIRED, ERR_ROOM_INVITE_EXPIRED);
  if (uid !== core.users.ownerId() && !core.rooms.member(r.grp, uid)) {
    core.rooms.add(r.grp, uid, "member");
    await core.rooms.useInvite(code);
    core.chats.patchChat(r.grp, {});
    syncChats(core, r.grp);
  }
  return r.grp;
}

async function join(c: ReqCtx): Promise<Response> {
  const body = ((await readJson(c.req)) ?? {}) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const uid = c.who.owner ? c.core.users.ownerId() : c.who.member?.user.id;
  if (!uid) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const grp = await joinRoom(c.core, uid, code);
  const chat = c.who.owner ? ownerView(c.core, c.core.chats.chat(grp) ?? { channel: grp, updated: Date.now() }) : memberView(c.core, grp, uid);
  return json({ chat: chat ?? { channel: grp, updated: Date.now() } } satisfies RoomJoined);
}

export const ROOM_ROUTES: Route[] = [
  route(GET, PATH_CHAT_MEMBERS, ROOM, listMembers),
  route(POST, PATH_CHAT_MEMBERS, ROOM, addMember),
  route(PATCH, PATH_CHAT_MEMBER, ROOM, patchMember),
  route(DELETE, PATH_CHAT_MEMBER, ROOM, removeMember),
  route(POST, PATH_CHAT_INVITES, ROOM, createInvite),
  route(POST, PATH_ROOM_JOIN, ROOM, join),
];
