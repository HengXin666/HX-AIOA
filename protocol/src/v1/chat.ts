import { API_V1 } from "./constants";
import type { Envelope } from "./event";

// 群资料: 群就是 channel; 字段都可选, 没设置的群不存行
export type DigestKind = "daily" | "weekly";
export type ChatMeta = {
  channel: string;
  title?: string;
  avatar?: string;
  pinned?: boolean;
  muted?: boolean;
  read?: number;
  digest?: DigestKind;
  agents?: ChatAgent[];
  updated: number;
};
// 群里接入的 Agent: 一个来源 + 一把 key; brief 是 "怎么使唤它", 存服务端, Agent 挂了可重新接入
export type ChatAgent = {
  keyId: string;
  sourceId: string;
  name: string;
  brief: string;
  reads: string[];
  created: number;
  rotated?: number;
};
export type ChatPatch = Partial<Pick<ChatMeta, "title" | "avatar" | "pinned" | "muted" | "read" | "digest">>;
export type AgentRequest = { name: string; brief?: string; reads?: string[] };
export type Favorite = { seq: number; saved: number; ev: Envelope };
export type OnboardResult = { agent: ChatAgent; prompt: string };
export type ChatMessages = { messages: Envelope[]; head: number };
// 资料 / 收藏变化时广播, 客户端据此增量拉取
export type ChatSyncFrame = { t: "chat_sync"; topic: "chats" | "favorites"; channel?: string };

export const DIGEST_KINDS = ["daily", "weekly"] as const;
export const MAX_BRIEF_LENGTH = 8000;
export const MAX_AVATAR_BYTES = 64 * 1024;
export const MAX_CHAT_AGENTS = 8;
export const MAX_AGENT_READS = 32;

export const PATH_CHATS = `${API_V1}/chats`;
export const PATH_CHAT = `${API_V1}/chats/{channel}`;
export const PATH_CHAT_MESSAGES = `${API_V1}/chats/{channel}/messages`;
export const PATH_CHAT_AGENTS = `${API_V1}/chats/{channel}/agents`;
export const PATH_CHAT_AGENT = `${API_V1}/chats/{channel}/agents/{keyId}`;
export const PATH_CHAT_AGENT_ROTATE = `${API_V1}/chats/{channel}/agents/{keyId}/rotate`;
export const PATH_CHAT_AGENT_PROMPT = `${API_V1}/chats/{channel}/agents/{keyId}/prompt`;
export const PATH_FAVORITES = `${API_V1}/favorites`;
export const PATH_FAVORITE = `${API_V1}/favorites/{seq}`;
export const PATH_AVATARS = `${API_V1}/avatars`;
export const PATH_AVATAR = `${API_V1}/avatars/{id}`;
export const PATH_EVENT_BY_SEQ = `${API_V1}/events/seq/{seq}`;
