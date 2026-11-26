import { API_V1 } from "./constants";
import type { AgentTrigger, SkillReport } from "./agent-skill";
import type { Envelope } from "./event";
import type { FeedTag } from "./feed-tags";
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
  // 信息流标签表与版本 (见 feed-tags.ts); 不写用默认四类, rev 0
  feedTags?: FeedTag[];
  feedRev?: number;
  // 群主 / 管理员关掉 "正在监听" 与 "正在输入" 提示 (省额度); 不写为开
  hideListening?: boolean;
  hideTyping?: boolean;
  // 群被删除的时间: 只留这一行墓碑让各端删本地记录并隐藏; 之后再有消息进来群会重新出现
  deleted?: number;
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
  // 最近一次用这把 key 拉消息 / 发消息 / 拉指令的时间, 最多每 10 分钟记一次
  active?: number;
  // 最近一次报到的指令版本与客户端 (如 "hxaioa 0.2.0", 直接调接口为 "接口")
  version?: string;
  client?: string;
  // 已在群里发过 "指令已更新" 通知的版本, 同一版本只通知一次
  notified?: string;
  // 以下为 skill 版 Agent (agent-skill.ts): 处理游标 (seq 不大于它的人发消息都处理过) 与游标之后零散已处理的 seq
  handled?: number;
  handledSet?: number[];
  // 最近上报的已装版本 (X-Aioa-Skill), 只在变化时写
  skills?: SkillReport;
  // 服务端要求的接入版本: 开关大更新自动执行或出现必须重新接入的改动时加 1
  setup?: number;
  autoMajor?: boolean;
  trigger?: AgentTrigger;
  lastRun?: number;
  // 已在群里提醒过的大版本缺失, 形如 "hengxin666.todo@2:new" 或 ":remind"
  warned?: string[];
};
// 接入时可选带上定时与任务, 只写进这次的接入语, 不存
export type AgentJob = { interval?: number; task?: string };
export type ChatPatch = Partial<Pick<ChatMeta, "title" | "avatar" | "pinned" | "muted" | "read" | "digest" | "hideListening" | "hideTyping" | "view" | "feedTags">>;
export type AgentRequest = { name: string; reads?: string[] } & AgentJob;
export const AGENT_ACTIVE_STEP_MS = 120_000;
export const MAX_AGENT_TASK = 2000;
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
