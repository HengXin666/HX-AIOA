import {
  DIGEST_KINDS,
  MAX_ID_LENGTH,
  MAX_NOTICE_LENGTH,
  MAX_TITLE_LENGTH,
  PATH_CHAT,
  PATH_CHATS,
  PATH_DMS,
  dmChannel,
  dmPeers,
  parseFeedTags,
  type ChatMeta,
  type ChatPatch,
  type DmCreated,
} from "@hx-aioa/protocol";
import { canRead } from "./api-chats";
import { pushRead, syncChat, syncSelf } from "./chat-sync";
import { CODE_FORBIDDEN, CODE_NOT_FOUND, ERR_BAD_CHANNEL, ERR_DM, ERR_FORBIDDEN, GET, PATCH, POST } from "./constants";
import { type Core, ROOM, type ReqCtx, type Route, route } from "./core";
import { etagged, fail, json, readJson } from "./http";
import { memberView, ownerSees, ownerView, roleIn } from "./room-access";

const READ_SCOPE = "events:read";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// 只影响自己的字段: 子号存在成员表, 主人存在群资料 (子号视图会去掉)
const PERSONAL = ["pinned", "muted", "digest"];
const SHARED = ["title", "avatar", "hideListening", "hideTyping", "notice"] as const;

/** 当前请求者的账号 id; key 没有。 */
function uidOf(c: ReqCtx): string | null {
  if (c.who.owner) return c.core.users.ownerId();
  return c.who.member?.user.id ?? null;
}

function visibleChats(c: ReqCtx): ChatMeta[] {
  const core = c.core;
  if (c.who.owner) {
    const reads = core.chats.reads.all(core.users.ownerId());
    return core.chats.chats().filter((m) => ownerSees(core, m.channel)).map((m) => ownerView(core, m, reads));
  }
  const member = c.who.member;
  if (member) return core.rooms.roomsOf(member.user.id).flatMap((m) => memberView(core, m.grp, member.user.id) ?? []);
  return core.chats.chats().filter((m) => canRead(core, c.who, m.channel)).map(({ agents: _a, ...rest }) => rest);
}

function hash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** GET /chats 的 ETag (#129): 群资料版本 + 本人已读; 子号再加自己的成员行。304 时不读全表。 */
function chatsTag(c: ReqCtx): string {
  const rev = c.core.chats.rev();
  const uid = uidOf(c);
  if (!uid) return `k-${rev}`;
  const reads = c.core.chats.reads.tag(uid);
  if (c.who.owner) return `o-${rev}-${reads}`;
  const rooms = c.core.rooms.roomsOf(uid).map((m) => `${m.grp}|${m.role}|${m.joined}|${JSON.stringify(m.prefs)}`);
  return `m-${rev}-${reads}-${hash(rooms.join("\n"))}`;
}

function listChats(c: ReqCtx): Response {
  if (!c.who.owner && !c.who.member && !c.who.key.scopes.includes(READ_SCOPE)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  return etagged(c.req, chatsTag(c), () => ({ chats: visibleChats(c) }));
}

function parsePatch(raw: unknown): ChatPatch | string {
  if (!isObj(raw)) return "资料必须是对象";
  const out: ChatPatch = {};
  if ("title" in raw) {
    if (raw.title !== null && !(typeof raw.title === "string" && raw.title.length <= MAX_TITLE_LENGTH)) return "title 过长";
    out.title = (raw.title as string | null) ?? "";
  }
  if ("avatar" in raw) {
    if (raw.avatar !== null && typeof raw.avatar !== "string") return "avatar 必须是头像 id";
    out.avatar = (raw.avatar as string | null) ?? "";
  }
  if ("notice" in raw) {
    if (raw.notice !== null && !(typeof raw.notice === "string" && raw.notice.length <= MAX_NOTICE_LENGTH)) return `notice 最多 ${MAX_NOTICE_LENGTH} 字`;
    out.notice = (raw.notice as string | null) ?? "";
  }
  for (const k of ["pinned", "muted", "hideListening", "hideTyping"] as const) if (k in raw) out[k] = raw[k] === true;
  if ("read" in raw) {
    if (typeof raw.read !== "number") return "read 必须是 seq";
    out.read = raw.read;
  }
  if ("view" in raw) {
    // 邮件视图只由服务端设置, 主人只能在聊天与信息流之间切
    if (raw.view !== "chat" && raw.view !== "feed") return "view 只能是 chat 或 feed";
    out.view = raw.view;
  }
  if ("feedTags" in raw) {
    // null 表示恢复默认四类
    const t = raw.feedTags === null ? null : parseFeedTags(raw.feedTags);
    if (typeof t === "string") return t;
    (out as Record<string, unknown>).feedTags = t;
  }
  if ("digest" in raw) {
    if (raw.digest !== null && !(DIGEST_KINDS as readonly unknown[]).includes(raw.digest)) return "digest 只能是 daily 或 weekly";
    // null 表示取消, 由 patchChat 删除该字段
    (out as Record<string, unknown>).digest = raw.digest;
  }
  return out;
}

const pick = (p: ChatPatch, keys: readonly string[]) => Object.fromEntries(Object.entries(p).filter(([k, v]) => keys.includes(k) && v !== undefined));

/** 子号改群: 置顶免打扰是自己的; 管理员还能改共享的标题, 头像, 公告与提示开关。 */
function memberPatch(core: Core, channel: string, uid: string, admin: boolean, p: ChatPatch): Response {
  const { pinned, muted } = p;
  if (pinned !== undefined || muted !== undefined) core.rooms.patchPrefs(channel, uid, { ...(pinned !== undefined ? { pinned } : {}), ...(muted !== undefined ? { muted } : {}) });
  const shared = pick(p, SHARED);
  if (admin && Object.keys(shared).length) {
    core.chats.patchChat(channel, shared as ChatPatch);
    syncChat(core, channel);
  } else if (pinned !== undefined || muted !== undefined) syncSelf(core, channel, uid);
  return json({ chat: memberView(core, channel, uid) });
}

async function patchChat(c: ReqCtx): Promise<Response> {
  const core = c.core;
  const channel = decodeURIComponent(c.params[0] ?? "");
  if (!channel || channel.length > MAX_ID_LENGTH) return fail(400, ERR_BAD_CHANNEL);
  const p = parsePatch(await readJson(c.req));
  if (typeof p === "string") return fail(400, p);
  const role = roleIn(core, c.who, channel);
  const uid = uidOf(c);
  if (!role || !uid) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const { read, ...rest } = p;
  // 已读单独存, 只推给本人的其它设备 (#129)
  if (read !== undefined && core.chats.reads.mark(uid, channel, read)) pushRead(core, uid, channel, read);
  const dm = dmPeers(channel) !== null;
  if (dm && Object.keys(rest).some((k) => !PERSONAL.includes(k))) return fail(400, `${ERR_DM}改群资料`);
  if (role !== "owner") return memberPatch(core, channel, uid, role === "admin" && !dm, rest);
  if (!Object.keys(rest).length) return json({ chat: ownerView(core, core.chats.chat(channel) ?? { channel, updated: Date.now() }) });
  if (rest.view && core.chats.chat(channel)?.view === "mail") return fail(400, "邮件群不能切换展示方式");
  // 改标签表时 rev 加一, Agent 的专属指令跟着变, 会收到更新通知
  const rev = "feedTags" in rest ? { feedRev: (core.chats.chat(channel)?.feedRev ?? 0) + 1 } : {};
  const meta = core.chats.patchChat(channel, { ...rest, ...rev } as ChatPatch);
  syncChat(core, channel, { ownerOnly: Object.keys(rest).every((k) => PERSONAL.includes(k)) });
  return json({ chat: ownerView(core, meta) });
}

/** POST /dms (#133): 和一个已有的真人账号单聊; 已有就直接返回。 */
async function createDm(c: ReqCtx): Promise<Response> {
  const core = c.core;
  const me = uidOf(c);
  if (!me) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const body = await readJson(c.req);
  const ref = isObj(body) && typeof body.peer === "string" ? body.peer : "";
  const peer = ref ? core.users.get(ref) : null;
  if (!peer || peer.status !== "active") return fail(404, "没有这个账号", CODE_NOT_FOUND);
  if (peer.id === me) return fail(400, `${ERR_DM}和自己聊`);
  const channel = dmChannel(me, peer.id);
  const owner = core.users.ownerId();
  for (const u of [me, peer.id]) if (u !== owner) core.rooms.add(channel, u, "member");
  const cur = core.chats.chat(channel);
  if (!cur || cur.deleted) {
    core.chats.replaceChat({ channel, kind: "dm", updated: Date.now(), ...(cur?.cleared ? { cleared: cur.cleared } : {}) });
    syncChat(core, channel);
  }
  const meta = core.chats.chat(channel) ?? { channel, updated: Date.now() };
  const chat = me === owner ? ownerView(core, meta) : memberView(core, channel, me);
  return json({ chat: chat ?? meta } satisfies DmCreated);
}

export const CHAT_META_ROUTES: Route[] = [route(GET, PATH_CHATS, ROOM, listChats), route(PATCH, PATH_CHAT, ROOM, patchChat), route(POST, PATH_DMS, ROOM, createDm)];
