import { API_V1 } from "./constants";
import type { ChatMeta } from "./chat";

// 多人群: 消息只存一份 (主库按 grp 分), 成员表决定谁能看, 推送只发给在线成员
export const ROOM_ROLES = ["owner", "admin", "member"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];
// avatar: 账号头像 id (GET /avatars/{id}), 本人用 PATCH /me 设置
export type RoomMember = { id: string; name: string; display: string; role: RoomRole; joined: number; avatar?: string };
// 分页 (#130): next 为下一页的 cursor, 没有下一页时不给; 主人 (群主) 只在第一页
export type RoomMembers = { members: RoomMember[]; next?: string };
export const MEMBERS_DEFAULT_LIMIT = 50;
export const MEMBERS_MAX_LIMIT = 200;
export const QUERY_CURSOR = "cursor";
export const QUERY_Q = "q";
export type RoomInviteRequest = { ttlHours?: number; maxUses?: number };
// link 给浏览器打开 (说明页), appLink 由 App 直接接住
export type RoomInviteCreated = { code: string; link: string; appLink: string; expires: number; maxUses: number };
export type RoomJoinRequest = { code: string };
export type RoomJoined = { chat: ChatMeta };

export const ROOM_INVITE_PREFIX = "hxr_";
export const ROOM_INVITE_TTL_HOURS = 72;
export const ROOM_INVITE_MAX_TTL_HOURS = 24 * 30;
export const ROOM_INVITE_MAX_USES = 50;
export const APP_SCHEME = "hxaioa";
export const QUERY_CODE = "code";
export const QUERY_SERVER = "server";

export const PATH_CHAT_MEMBERS = `${API_V1}/chats/{channel}/members`;
export const PATH_CHAT_MEMBER = `${API_V1}/chats/{channel}/members/{id}`;
// 成员在线状态 (#130): online 为有前台连接的账号 id, seen 为最近在线时间 (ms), 读不到的不给; 只在内存, 不落库
export const PATH_CHAT_PRESENCE = `${API_V1}/chats/{channel}/presence`;
export type ChatPresence = { online: string[]; seen: Record<string, number> };
// 和某个账号的共同群 (#139, 资料卡): 调用者与 {id} 都在的群, 不含单聊; 主人算在所有群里
export const PATH_USER_ROOMS = `${API_V1}/users/{id}/rooms`;
export type UserRooms = { channels: string[] };
export const PATH_CHAT_INVITES = `${API_V1}/chats/{channel}/invites`;
export const PATH_ROOM_JOIN = `${API_V1}/rooms/join`;
// 邀请链接在浏览器里打开的说明页, 不需要登录
export const PATH_JOIN_PAGE = "/join/{code}";
