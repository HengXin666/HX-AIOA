export const PROTOCOL_VERSION = 2;

export * from "./v1/constants";
export * from "./v1/event";
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

export const METRIC_LIVE_INTERVAL_MS = 2000;
export const MAX_SUBJECTS = 64;
export const MAX_METRIC_POINTS = 1440;

export type TextBody = { kind: "text"; text: string };
export type Body = TextBody;

// reply / fwd 为被引用 / 被转发消息的 seq, channel 为目标群 (不写为备忘)
export type SendFrame = { t: "send"; cid: string; body: Body; reply?: number; fwd?: number; channel?: string };
export type AckFrame = { t: "ack"; seq: number };
export type RegFrame = { t: "reg"; pushToken: string };
// 懒更新指标: 客户端声明在看哪些主体, 探针声明能提供哪些主体, 服务端只在有人看时向探针要数据
export type WatchFrame = { t: "watch"; subjects: string[] };
export type OfferFrame = { t: "offer"; subjects: string[] };
export type MetricPoint = { ts: number; values: Record<string, number> };
export type MetricFrame = { t: "metric"; subject: string; points: MetricPoint[]; history?: boolean };
export type ClientFrame = SendFrame | AckFrame | RegFrame | WatchFrame | OfferFrame | MetricFrame;

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
export type ServerFrame = WelcomeFrame | MsgFrame | SentFrame | ErrFrame | DemandFrame | MetricFrame | ProbesFrame;

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
    default:
      return null;
  }
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
