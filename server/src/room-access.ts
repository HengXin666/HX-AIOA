import { dmPeers, type ChatAgent, type ChatMeta, type RoomRole } from "@hx-aioa/protocol";
import { CODE_FORBIDDEN, ERR_FORBIDDEN } from "./constants";
import type { Core, Principal } from "./core";
import { ApiFail } from "./http";

// 我在群里的身份: 主人在所有群都是群主; 子号看成员表; key 不是成员
export function roleIn(core: Core, who: Principal, grp: string): RoomRole | null {
  if (who.owner) return "owner";
  if (!who.member) return null;
  return core.rooms.member(grp, who.member.user.id)?.role ?? null;
}

export function mustRole(core: Core, who: Principal, grp: string, min: RoomRole): RoomRole {
  const role = roleIn(core, who, grp);
  if (!role || rank(role) < rank(min)) throw new ApiFail(403, CODE_FORBIDDEN, ERR_FORBIDDEN);
  return role;
}

export function rank(role: RoomRole): number {
  return role === "owner" ? 2 : role === "admin" ? 1 : 0;
}

// 人发的消息记下发送者账号; 用母号 token 时记母号
export function authorOf(core: Core, who: Principal): string | undefined {
  if (who.owner) return who.user?.id ?? core.users.ownerId();
  return who.member?.user.id;
}

// 单聊: 两人都是普通成员, peer 是对方, 没起名时用对方昵称当标题
function dmView(core: Core, view: ChatMeta, uid: string): ChatMeta {
  const pair = dmPeers(view.channel);
  if (!pair) return view;
  const peer = pair[0] === uid ? pair[1] : pair[0];
  const u = core.users.get(peer);
  return { ...view, kind: "dm", peer, role: "member", members: 2, ...(!view.title && u ? { title: u.display || u.name } : {}) };
}

/** 主人能不能看到这个群: 别人之间的单聊不给主人看。 */
export function ownerSees(core: Core, channel: string): boolean {
  const pair = dmPeers(channel);
  return !pair || pair.includes(core.users.ownerId());
}

const withRead = (view: ChatMeta, read: number): ChatMeta => (read > (view.read ?? 0) ? { ...view, read } : view);

// 子号看到的群资料: 共享的标题头像 + 自己的置顶免打扰已读; Agent 等主人私有字段不给
export function memberView(core: Core, grp: string, uid: string): ChatMeta | null {
  const m = core.rooms.member(grp, uid);
  if (!m) return null;
  const meta = core.chats.chat(grp) ?? { channel: grp, updated: m.joined };
  const { agents: _a, pinned: _p, muted: _m, read: _r, digest: _d, ...shared } = meta;
  const view = { ...shared, ...m.prefs, role: m.role, members: core.rooms.count(grp) + 1, updated: Math.max(meta.updated, m.joined) };
  return dmView(core, withRead(view, core.chats.reads.get(uid, grp)), uid);
}

// 主人看到的群资料: 多人群补上身份与人数, 已读取 chat_read, Agent 活跃合进内存里较新的
export function ownerView(core: Core, meta: ChatMeta, reads?: Map<string, number>): ChatMeta {
  const owner = core.users.ownerId();
  let view = withRead(meta, reads ? (reads.get(meta.channel) ?? 0) : core.chats.reads.get(owner, meta.channel));
  const live = (a: ChatAgent) => core.chats.active.get(a.keyId) ?? 0;
  const agents = view.agents ?? [];
  if (agents.some((a) => live(a) > (a.active ?? 0))) view = { ...view, agents: agents.map((a) => (live(a) > (a.active ?? 0) ? { ...a, active: live(a) } : a)) };
  const n = core.rooms.count(meta.channel);
  if (n) view = { ...view, role: "owner", members: n + 1 };
  return dmView(core, view, owner);
}
