import { API_V1 } from "./constants";
import type { Envelope } from "./event";
import type { ChatView } from "./mail";
import type { RoomRole } from "./room";

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
  // 多人群: 我在群里的身份与成员数; 只有自己的群没有这两项
  role?: RoomRole;
  members?: number;
  // 清空聊天记录时的位置: 该群 seq <= cleared 的消息客户端一并删掉
  cleared?: number;
  // 展示方式, 不写为聊天; 邮件群为 mail
  view?: ChatView;
  // 群主 / 管理员关掉 "正在监听" 与 "正在输入" 提示 (省额度); 不写为开
  hideListening?: boolean;
  hideTyping?: boolean;
  updated: number;
};
// 群里接入的 Agent: 一个来源 + 一把 key; 主人只定名字和可读的群, 指令由服务端下发
// joined 为最近一次报到时间, pending 表示指令变了但它还没重新报到; brief 只是旧数据
export type ChatAgent = {
  keyId: string;
  sourceId: string;
  name: string;
  reads: string[];
  created: number;
  rotated?: number;
  joined?: number;
  pending?: boolean;
  brief?: string;
  // 由插件安装创建时为插件 id, 专属指令里会带上插件的提示词
  plugin?: string;
};
export type ChatPatch = Partial<Pick<ChatMeta, "title" | "avatar" | "pinned" | "muted" | "read" | "digest" | "hideListening" | "hideTyping">>;
export type AgentRequest = { name: string; reads?: string[] };
export type AgentAck = { version: string };
// 收藏按引用: ev 是原消息的当前版本; gone 表示原消息已撤回 / 删除 / 清空, ev 只剩收藏时的摘要
export type Favorite = { seq: number; saved: number; ev: Envelope; gone?: boolean };
// 接入 / 重新接入结果, 只给这一次: prompt 一段接入语 (文档链接, 任务, 密钥), key 另给一份方便单独复制
export type OnboardResult = { agent: ChatAgent; prompt: string; key: string };
export type ChatMessages = { messages: Envelope[]; head: number };
export type ChatCleared = { deleted: number; cleared: number };
// 资料 / 收藏变化时广播, 客户端据此增量拉取
export type ChatSyncFrame = { t: "chat_sync"; topic: "chats" | "favorites" | "todos"; channel?: string };

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
// 群 Agent 用自己的 key 拉取接入指令与报到
export const PATH_AGENT_GUIDE = `${API_V1}/chat-agent/guide`;
export const PATH_AGENT_GUIDE_ACK = `${API_V1}/chat-agent/ack`;
export const HEADER_GUIDE_VERSION = "X-Aioa-Guide-Version";
export const PATH_FAVORITES = `${API_V1}/favorites`;
export const PATH_FAVORITE = `${API_V1}/favorites/{seq}`;
export const PATH_AVATARS = `${API_V1}/avatars`;
export const PATH_AVATAR = `${API_V1}/avatars/{id}`;
export const PATH_EVENT_BY_SEQ = `${API_V1}/events/seq/{seq}`;
