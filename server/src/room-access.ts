import type { ChatMeta, RoomRole } from "@hx-aioa/protocol";
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

// 子号看到的群资料: 共享的标题头像 + 自己的置顶免打扰已读; Agent 等主人私有字段不给
export function memberView(core: Core, grp: string, uid: string): ChatMeta | null {
  const m = core.rooms.member(grp, uid);
  if (!m) return null;
  const meta = core.chats.chat(grp) ?? { channel: grp, updated: m.joined };
  const { agents: _a, pinned: _p, muted: _m, read: _r, digest: _d, ...shared } = meta;
  return { ...shared, ...m.prefs, role: m.role, members: core.rooms.count(grp) + 1, updated: Math.max(meta.updated, m.joined) };
}

// 主人看到的群资料: 多人群补上身份与人数
export function ownerView(core: Core, meta: ChatMeta): ChatMeta {
  const n = core.rooms.count(meta.channel);
  return n ? { ...meta, role: "owner", members: n + 1 } : meta;
}
