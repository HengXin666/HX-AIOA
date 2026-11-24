import { API_V1 } from "./constants";

// 群里的实时状态: 谁 (Agent) 在监听, 谁在输入。只在服务端内存里, 不落库, 也不进消息
// until: 到这个时间 (ms) 还没续上就当已离开, 客户端自己按它过期; 没有 until 表示长连接在线
export type PresenceEntry = { id: string; name: string; until?: number };
export type PresenceFrame = { t: "presence"; channel: string; listening: PresenceEntry[]; typing: PresenceEntry[] };
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

export function parseTyping(f: Record<string, unknown>): TypingFrame | null {
  return typeof f.channel === "string" && f.channel ? { t: "typing", channel: f.channel } : null;
}
