import { API_V1 } from "./constants";

// 群里的实时状态: 谁 (Agent) 在监听, 谁在输入。只在服务端内存里, 不落库, 也不进消息
// until: 到这个时间 (ms) 还没续上就当已离开, 客户端自己按它过期; 没有 until 表示长连接在线
export type PresenceEntry = { id: string; name: string; until?: number };
export type PresenceFrame = { t: "presence"; channel: string; listening: PresenceEntry[]; typing: PresenceEntry[] };
// 真人在线 (#139): 只发给同群的人。full 为连上时的全量 (客户端整表替换), 否则是增量:
// online 里的人现在在线, seen 里的人已离线, 值为最近在线时间 (ms)
export type OnlineFrame = { t: "online"; full?: boolean; online: string[]; seen: Record<string, number> };
// 客户端 / CLI -> 服务端: 我正在这个群输入; 输入期间最多每 TYPING_THROTTLE_MS 发一次
export type TypingFrame = { t: "typing"; channel: string };
// CLI 长连 (role=chat) 连上时的身份, 跟在 welcome 里
export type ChatAgentMe = { keyId: string; name: string; channel?: string; sourceId?: string; reads: string[] };

export const TYPING_TTL_MS = 6000;
export const TYPING_THROTTLE_MS = 4000;
// 按 HTTP 拉取判断监听: 这么久内拉过就算在听, 拉取间隔应短于它
export const LISTEN_TTL_MS = 45_000;
export const PATH_CHAT_TYPING = `${API_V1}/chats/{channel}/typing`;
export const PATH_AGENT_ME = `${API_V1}/chat-agent/me`;
// 主人改了群 Agent 相关设置, 指令版本变了: 立刻推给这把 key 的长连, hxaioa watch 收到即退出码 3
export type GuideFrame = { t: "guide"; channel: string; version: string };
// Agent 的长期记忆: 存服务端, 换机器 / 云端每次新开也不丢; 只有这把 key 自己能读写
export const PATH_AGENT_MEMORY = `${API_V1}/chat-agent/memory`;
export const AGENT_MEMORY_MAX = 4000;
export type AgentMemory = { text: string; updated: number };

export function parseTyping(f: Record<string, unknown>): TypingFrame | null {
  return typeof f.channel === "string" && f.channel ? { t: "typing", channel: f.channel } : null;
}
