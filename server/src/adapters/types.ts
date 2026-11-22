import type { EventInput, EventStatus, JsonMapping, Severity } from "@hx-aioa/protocol";

export type HookInput = {
  body: unknown;
  headers: Headers;
  source: { name: string; subject?: string; mapping?: JsonMapping };
};

// 返回字符串表示无法解析, 空数组表示该通知无需入库 (如 CI 开始运行)
export type HookOutput = EventInput[] | string;
export type Adapter = (input: HookInput) => HookOutput;

export const SUMMARY_PREVIEW = 500;
export const CRITICAL: Severity = "critical";
export const WARNING: Severity = "warning";
export const NORMAL: Severity = "normal";
export const INFO: Severity = "info";
export const FIRING = "firing";
export const RESOLVED = "resolved";
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
export const clip = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);

export function event(title: string, severity: Severity, extra: Partial<EventInput> & { summary?: string; status?: EventStatus; url?: string } = {}): EventInput {
  const { summary, status, url, ...rest } = extra;
  const data: Record<string, unknown> = { title: clip(title, 300), severity };
  if (summary) data.summary = clip(summary, 8000);
  if (status) data.status = status;
  if (url) data.url = url;
  const out: EventInput = { kind: "event", ...rest, data: data as EventInput["data"] };
  if (status === RESOLVED) out.resolved = true;
  return out;
}

export function hostOf(v: string): string {
  try {
    return new URL(v).hostname;
  } catch {
    return v;
  }
}
