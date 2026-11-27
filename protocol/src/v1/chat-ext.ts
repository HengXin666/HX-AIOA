import { API_V1, MAX_ID_LENGTH } from "./constants";
import type { ChatMeta } from "./chat";
import type { Envelope } from "./event";

// @ 提醒 (#131): 账号 id, "agent:<keyId>" 或 "all"; 被 @ 的人即使群免打扰也提醒, 由客户端判断
export const MENTION_ALL = "all";
export const MENTION_AGENT_PREFIX = "agent:";
export const MAX_MENTIONS = 50;

// 合并转发 (#132): 发送时带原消息 seq, 服务端生成卡片; 详情用批量接口按 refs 取
export type BundleRequest = { from: string; seqs: number[] };
export type BundleHead = { src: string; text: string };
export type BundleInfo = { from: string; count: number; refs: number[]; head: BundleHead[] };
export const MAX_BUNDLE = 100;
export const BUNDLE_HEAD = 4;
export const BUNDLE_HEAD_TEXT = 60;
export const BUNDLE_TEXT_PREFIX = "[聊天记录]";
export const PATH_EVENTS_BY_SEQS = `${API_V1}/events/seq`;
export const QUERY_SEQS = "seqs";
// ?via=<卡片 seq>: 能读到这张卡片的人就能读它 refs 里的消息; 卡片里套的卡片用 via=外层,内层, 最多 BUNDLE_VIA_DEPTH 层
export const QUERY_VIA = "via";
export const BUNDLE_VIA_DEPTH = 2;
export type EventsBySeqs = { events: Envelope[] };

// 单聊 (#133): 群名由双方账号 id 字典序拼成, 两人都是普通成员
export const DM_PREFIX = "dm:";
export const PATH_DMS = `${API_V1}/dms`;
export type DmRequest = { peer: string };
export type DmCreated = { chat: ChatMeta };
export const MAX_NOTICE_LENGTH = 500;

export function dmChannel(a: string, b: string): string {
  return a < b ? `${DM_PREFIX}${a}:${b}` : `${DM_PREFIX}${b}:${a}`;
}

/** 单聊的双方; 不是单聊返回 null。 */
export function dmPeers(channel: string): [string, string] | null {
  if (!channel.startsWith(DM_PREFIX)) return null;
  const [a, b, ...rest] = channel.slice(DM_PREFIX.length).split(":");
  return a && b && !rest.length ? [a, b] : null;
}

const isSeq = (s: unknown): s is number => Number.isSafeInteger(s) && (s as number) > 0;

export function parseMentions(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= MAX_ID_LENGTH))].slice(0, MAX_MENTIONS);
  return out.length ? out : undefined;
}

export function parseBundle(v: unknown): BundleRequest | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const { from, seqs } = v as Record<string, unknown>;
  if (typeof from !== "string" || !Array.isArray(seqs) || !seqs.length || seqs.length > MAX_BUNDLE || !seqs.every(isSeq)) return undefined;
  return { from: from.slice(0, MAX_ID_LENGTH), seqs: [...new Set(seqs)] };
}

/** ?seqs=1,2,3: 最多 MAX_BUNDLE 个正整数, 不合法返回 null。 */
export function parseSeqList(raw: string | null): number[] | null {
  const list = (raw ?? "").split(",").filter(Boolean).map(Number);
  return list.length && list.length <= MAX_BUNDLE && list.every(isSeq) ? [...new Set(list)] : null;
}

// Agent 活跃与已读 (#129): 活跃只在内存, 推帧给主人, 最多每 30 分钟落库一次; 已读只推给本人的设备
export type AgentActiveFrame = { t: "agent_active"; channel: string; keyId: string; active: number };
export type ChatReadFrame = { t: "chat_read"; channel: string; read: number };
export const AGENT_ACTIVE_FLUSH_MS = 30 * 60_000;
