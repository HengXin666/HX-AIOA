// 终端: App ⇄ Hub ⇄ 探针 原样转发字节 (base64), 服务端不落库。
// 三道门: key 带 probe:shell, 探针本地 AIOA_SHELL=1 启动, owner 每次输入密码换一张 60 秒的票据。
export const TERM_TICKET_MS = 60_000;
export const TERM_IDLE_MS = 15 * 60_000;
export const TERM_MAX_DATA = 64 * 1024;
export const TERM_MAX_SESSIONS = 3;
const MAX_SID = 64;
const MAX_TICKET = 256;
const MAX_REASON = 120;
const MAX_DIM = 1000;

// 客户端开会话; 服务端校验票据后改写为不带票据的同名帧发给探针
export type TermOpenFrame = { t: "term_open"; sid: string; subject?: string; ticket?: string; cols: number; rows: number };
export type TermReadyFrame = { t: "term_ready"; sid: string };
export type TermDataFrame = { t: "term"; sid: string; d: string };
export type TermResizeFrame = { t: "term_resize"; sid: string; cols: number; rows: number };
export type TermCloseFrame = { t: "term_close"; sid: string; reason?: string };
export type TermFrame = TermOpenFrame | TermReadyFrame | TermDataFrame | TermResizeFrame | TermCloseFrame;

const isSid = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_SID;
const isDim = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAX_DIM;

export function parseTermFrame(f: Record<string, unknown>): TermFrame | null {
  if (!isSid(f.sid)) return null;
  switch (f.t) {
    case "term_open": {
      if (!isDim(f.cols) || !isDim(f.rows)) return null;
      const out: TermOpenFrame = { t: "term_open", sid: f.sid, cols: f.cols, rows: f.rows };
      if (typeof f.subject === "string" && f.subject.length <= MAX_SID) out.subject = f.subject;
      if (typeof f.ticket === "string" && f.ticket.length <= MAX_TICKET) out.ticket = f.ticket;
      return out;
    }
    case "term_ready":
      return { t: "term_ready", sid: f.sid };
    case "term":
      return typeof f.d === "string" && f.d.length <= TERM_MAX_DATA ? { t: "term", sid: f.sid, d: f.d } : null;
    case "term_resize":
      return isDim(f.cols) && isDim(f.rows) ? { t: "term_resize", sid: f.sid, cols: f.cols, rows: f.rows } : null;
    case "term_close":
      return { t: "term_close", sid: f.sid, ...(typeof f.reason === "string" ? { reason: f.reason.slice(0, MAX_REASON) } : {}) };
    default:
      return null;
  }
}
