export const PROTOCOL_VERSION = 2;

export * from "./v1/constants";
export * from "./v1/event";
export * from "./v1/feed";
export * from "./v1/feed-tags";
export * from "./v1/task";
export * from "./v1/space";
export * from "./v1/space-layout";
export * from "./v1/metric-fields";
export * from "./v1/rule";
export * from "./v1/frames";
export * from "./v1/api";
export * from "./v1/source";
export * from "./v1/paths";
export * from "./v1/github";
export * from "./v1/chat";
export * from "./v1/room";
export * from "./v1/files";
export * from "./v1/plugin";
export * from "./v1/plugin-v2";
export * from "./v1/plugin-check";
export * from "./v1/plugin-api";
export * from "./v1/semver";
export * from "./v1/mail";
export * from "./v1/term";
export * from "./v1/presence";
import { parseTermFrame, type TermFrame } from "./v1/term";
import { parseTyping, type TypingFrame } from "./v1/presence";

export const PING_TEXT = "ping";
export const PONG_TEXT = "pong";

export const WS_PATH = "/ws";
export const API_SEND_PATH = "/api/send";
export const API_MESSAGES_PATH = "/api/messages";
export const HEALTH_PATH = "/health";

export const QUERY_TOKEN = "token";
export const QUERY_DEVICE = "device";
export const QUERY_SINCE = "since";
export const QUERY_LIMIT = "limit";

export const ANDROID_DEVICE_PREFIX = "android";
export const PROBE_DEVICE_PREFIX = "probe";
// 人发的消息: source.id = "user:<账号 id>", source.type = "user", name 为账号昵称; 设备 id 不再当来源
export const USER_SOURCE_PREFIX = "user:";
export const SOURCE_TYPE_USER = "user";

export const METRIC_LIVE_INTERVAL_MS = 2000;
export const MAX_SUBJECTS = 64;
export const MAX_METRIC_POINTS = 1440;
// 主机卡片快照间隔: 探针连上时发一次, 之后每 10 分钟一次
export const HOST_SNAPSHOT_MS = 600_000;
const MAX_HOST_TEXT = 128;

export type TextBody = { kind: "text"; text: string };
export type Body = TextBody;

// reply / fwd 为被引用 / 被转发消息的 seq, channel 为目标群 (不写为备忘)
// file: 已上传文件的 id, 作为这条消息的附件
export type SendFrame = { t: "send"; cid: string; body: Body; reply?: number; fwd?: number; channel?: string; file?: string };
export type AckFrame = { t: "ack"; seq: number };
export type RegFrame = { t: "reg"; pushToken: string };
// 懒更新指标: 客户端声明在看哪些主体, 探针声明能提供哪些主体, 服务端只在有人看时向探针要数据
export type WatchFrame = { t: "watch"; subjects: string[] };
export type OfferFrame = { t: "offer"; subjects: string[] };
export type MetricPoint = { ts: number; values: Record<string, number> };
export type MetricFrame = { t: "metric"; subject: string; points: MetricPoint[]; history?: boolean };
// 主机卡片: 服务端只放在探针那条连接的 attachment 里 (休眠也在), 不落库; 断开时记一行离线快照
export type HostInfo = { hostname?: string; ip?: string; os?: string; arch?: string; cores?: number; memTotal?: number; diskTotal?: number; bootAt?: number; shell?: boolean };
// beats: 心跳条, 从旧到新每格一个字符 (g 正常, y 延迟大, r 失联, n 无数据), 最后一格截至 beatsAt
export type HostFrame = { t: "host"; subject: string; info: HostInfo; last?: MetricPoint; avail?: number; beats?: string; beatsAt?: number };
export type HostCard = { subject: string; online: boolean; seen: number; info: HostInfo; last?: MetricPoint; avail?: number; beats?: string; beatsAt?: number };
export const BEAT_SLOTS = 60;
export const BEAT_SLOT_MS = 24 * 60_000;
const BEATS_RE = /^[gyrn]{1,96}$/;
export type ClientFrame = SendFrame | AckFrame | RegFrame | WatchFrame | OfferFrame | MetricFrame | HostFrame | TermFrame | TypingFrame;

export type WelcomeFrame = { t: "welcome"; head: number };
export type MsgFrame = {
  t: "msg";
  seq: number;
  ts: number;
  src: string;
  body: Body;
  cid?: string;
};
export type SentFrame = { t: "sent"; cid: string; seq: number; ts: number };
export type ErrFrame = { t: "err"; code: string; text: string; aid?: string };
export type ProbesFrame = { t: "probes"; subjects: string[] };
export type DemandFrame = { t: "demand"; subjects: string[]; intervalMs: number };
export type HostsFrame = { t: "hosts"; hosts: HostCard[] };
export type ServerFrame = WelcomeFrame | MsgFrame | SentFrame | ErrFrame | DemandFrame | MetricFrame | ProbesFrame | HostsFrame;

export type SendRequest = { src?: string; body: Body };
export type SendResult = { seq: number; ts: number };

export function isBody(value: unknown): value is Body {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.kind === "text" && typeof v.text === "string";
}

export function parseClientFrame(raw: string): ClientFrame | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const f = data as Record<string, unknown>;
  switch (f.t) {
    case "send":
      if (typeof f.cid !== "string" || !isBody(f.body)) return null;
      return {
        t: "send",
        cid: f.cid,
        body: f.body,
        ...(typeof f.reply === "number" ? { reply: f.reply } : {}),
        ...(typeof f.fwd === "number" ? { fwd: f.fwd } : {}),
        ...(typeof f.channel === "string" && f.channel ? { channel: f.channel } : {}),
      };
    case "ack":
      return typeof f.seq === "number" ? { t: "ack", seq: f.seq } : null;
    case "reg":
      return typeof f.pushToken === "string" ? { t: "reg", pushToken: f.pushToken } : null;
    case "watch":
    case "offer":
      return isSubjects(f.subjects) ? { t: f.t, subjects: f.subjects } : null;
    case "metric":
      return typeof f.subject === "string" && isPoints(f.points)
        ? { t: "metric", subject: f.subject, points: f.points, history: f.history === true }
        : null;
    case "host":
      return parseHost(f);
    case "typing":
      return parseTyping(f);
    default:
      return parseTermFrame(f);
  }
}

const HOST_TEXT_KEYS = ["hostname", "ip", "os", "arch"] as const;
const HOST_NUM_KEYS = ["cores", "memTotal", "diskTotal", "bootAt"] as const;

// 只收认识的字段, 文本截断, 保证 attachment 不超限
function parseHost(f: Record<string, unknown>): HostFrame | null {
  if (typeof f.subject !== "string" || typeof f.info !== "object" || f.info === null) return null;
  const raw = f.info as Record<string, unknown>;
  const info: HostInfo = {};
  for (const k of HOST_TEXT_KEYS) if (typeof raw[k] === "string") info[k] = (raw[k] as string).slice(0, MAX_HOST_TEXT);
  for (const k of HOST_NUM_KEYS) if (typeof raw[k] === "number" && Number.isFinite(raw[k])) info[k] = raw[k] as number;
  if (raw.shell === true) info.shell = true;
  const out: HostFrame = { t: "host", subject: f.subject, info };
  if (f.last !== undefined && isPoints([f.last])) out.last = f.last as MetricPoint;
  if (typeof f.avail === "number" && f.avail >= 0 && f.avail <= 100) out.avail = f.avail;
  if (typeof f.beats === "string" && BEATS_RE.test(f.beats) && typeof f.beatsAt === "number" && Number.isFinite(f.beatsAt)) {
    out.beats = f.beats;
    out.beatsAt = f.beatsAt;
  }
  return out;
}

function isSubjects(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_SUBJECTS && v.every((s) => typeof s === "string");
}

function isPoints(v: unknown): v is MetricPoint[] {
  if (!Array.isArray(v) || v.length > MAX_METRIC_POINTS) return false;
  return v.every((p) => {
    if (typeof p !== "object" || p === null) return false;
    const { ts, values } = p as Record<string, unknown>;
    if (typeof ts !== "number" || typeof values !== "object" || values === null) return false;
    return Object.values(values).every((x) => typeof x === "number");
  });
}

export function previewOf(body: Body): string {
  return body.text;
}
