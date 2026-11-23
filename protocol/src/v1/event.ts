import {
  EVENT_STATUSES,
  KINDS,
  MAX_ACTIONS,
  MAX_ID_LENGTH,
  MAX_REPORT_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TARGETS,
  MAX_TITLE_LENGTH,
  PRIORITIES,
  SEVERITIES,
  type DeliveryChannel,
  type EventStatus,
  type Kind,
  type Priority,
  type RuleAction,
  type Severity,
} from "./constants";
import type { TaskSnapshot } from "./task";

export type SourceRef = { id: string; name: string; icon?: string; type?: string };

export type Threshold = { warn?: number; crit?: number };
export type MetricData = {
  values: Record<string, number>;
  units?: Record<string, string>;
  thresholds?: Record<string, Threshold>;
};
export type EventData = {
  title: string;
  summary?: string;
  severity: Severity;
  status?: EventStatus;
  url?: string;
  // HTML 卡片 (周报之类): 客户端在沙箱里渲染, 不跑脚本不联网; 通知与列表仍用 title / summary
  html?: string;
};
export type ReportData = {
  title: string;
  summary?: string;
  markdown?: string;
  html?: string;
  blocks?: unknown[];
  refs?: string[];
  period?: string;
};
export type EventAction = { id: string; label: string; style?: "primary" | "danger"; url?: string };

// 引用: 被引用消息的快照, 原消息被清理后仍能显示
export type MsgRef = { seq: number; id: string; src: string; text: string };
// 转发: 原消息的来源与时间
export type FwdInfo = { src: string; ts: number; channel?: string };

// 撤回 / 删除留下的墓碑: 同 id 换新 seq 下发, 各端据此删掉或改成 "已撤回"; seq 是被替换那条的旧序号
export const DELETE_MODES = ["recall", "delete"] as const;
export type DeleteMode = (typeof DELETE_MODES)[number];
export type DeletedInfo = { mode: DeleteMode; at: number; seq: number };

// 规则引擎的决定, 随事件保存, 便于追溯为什么响铃或没响
export type RouteInfo = {
  action: RuleAction;
  channels: DeliveryChannel[];
  rule?: string;
  merged?: number;
  reason?: string;
};

type Common = {
  id: string;
  seq: number;
  ts: number;
  source: SourceRef;
  subject?: string;
  channel?: string;
  priority: Priority;
  dedupeKey?: string;
  groupKey?: string;
  actions?: EventAction[];
  ttl?: number;
  expires?: number;
  resolved?: boolean;
  root?: string;
  cid?: string;
  route?: RouteInfo;
  reply?: MsgRef;
  fwd?: FwdInfo;
  deleted?: DeletedInfo;
};
export type MetricEnvelope = Common & { kind: "metric"; data: MetricData };
export type EventEnvelope = Common & { kind: "event"; data: EventData };
export type TaskEnvelope = Common & { kind: "task"; data: TaskSnapshot };
export type ReportEnvelope = Common & { kind: "report"; data: ReportData };
export type Envelope = MetricEnvelope | EventEnvelope | TaskEnvelope | ReportEnvelope;

// 外部写入时的形状: id/seq/source 由服务端填, kind 默认 event, 允许 title/summary 等简写
export type EventInput = {
  kind: Exclude<Kind, "task">;
  channel?: string;
  to?: string[];
  subject?: string;
  priority?: Priority;
  dedupeKey?: string;
  groupKey?: string;
  actions?: EventAction[];
  ttl?: number;
  resolved?: boolean;
  ts?: number;
  // 只由服务端内部填写 (聊天发送), 外部写入不解析
  reply?: MsgRef;
  fwd?: FwdInfo;
  data: MetricData | EventData | ReportData;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false, error: string };

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const optStr = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function defaultPriority(kind: Kind, data: unknown): Priority {
  const d = (isObj(data) ? data : {}) as Record<string, unknown>;
  if (kind === "report") return "worth_reading";
  if (kind === "task") return d.state === "waiting" ? "need_me" : "happening";
  if (kind === "event") {
    if (d.severity === "critical") return "need_me";
    if (d.severity === "info") return "worth_reading";
  }
  return "happening";
}

function parseMetric(d: Record<string, unknown>): MetricData | string {
  if (!isObj(d.values)) return "metric 需要 data.values";
  if (!Object.values(d.values).every((x) => typeof x === "number")) return "data.values 只能是数值";
  const out: MetricData = { values: d.values as Record<string, number> };
  if (isObj(d.units)) out.units = d.units as Record<string, string>;
  if (isObj(d.thresholds)) out.thresholds = d.thresholds as Record<string, Threshold>;
  return out;
}

function parseEventData(d: Record<string, unknown>): EventData | string {
  const title = d.title ?? d.text;
  if (!str(title, MAX_TITLE_LENGTH)) return "event 需要 title (不超过 300 字)";
  if (!optStr(d.summary, MAX_SUMMARY_LENGTH)) return "summary 过长";
  const severity = d.severity ?? "normal";
  if (!oneOf(SEVERITIES, severity)) return "severity 取值错误";
  if (d.status !== undefined && !oneOf(EVENT_STATUSES, d.status)) return "status 取值错误";
  const out: EventData = { title, severity };
  if (typeof d.summary === "string" && d.summary) out.summary = d.summary;
  if (d.status) out.status = d.status as EventStatus;
  if (typeof d.url === "string" && d.url) out.url = d.url;
  if (d.html !== undefined) {
    if (typeof d.html !== "string" || d.html.length > MAX_REPORT_LENGTH) return "html 过大 (上限 64KB)";
    if (d.html) out.html = d.html;
  }
  return out;
}

function parseReport(d: Record<string, unknown>): ReportData | string {
  if (!str(d.title, MAX_TITLE_LENGTH)) return "report 需要 title";
  const size = JSON.stringify(d).length;
  if (size > MAX_REPORT_LENGTH) return "报告过大 (上限 64KB)";
  const out: ReportData = { title: d.title };
  if (typeof d.summary === "string") out.summary = d.summary;
  if (typeof d.markdown === "string") out.markdown = d.markdown;
  if (typeof d.html === "string" && d.html) out.html = d.html;
  if (Array.isArray(d.blocks)) out.blocks = d.blocks;
  if (Array.isArray(d.refs)) out.refs = d.refs.filter((x): x is string => typeof x === "string");
  if (typeof d.period === "string") out.period = d.period;
  return out;
}

function parseActions(v: unknown): EventAction[] | string | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX_ACTIONS) return "actions 最多 6 个";
  const out: EventAction[] = [];
  for (const a of v) {
    if (!isObj(a) || !str(a.id, MAX_ID_LENGTH) || !str(a.label, MAX_TITLE_LENGTH)) return "action 需要 id 与 label";
    const item: EventAction = { id: a.id, label: a.label };
    if (a.style === "primary" || a.style === "danger") item.style = a.style;
    if (typeof a.url === "string") item.url = a.url;
    out.push(item);
  }
  return out;
}

const SHORTHAND = ["title", "text", "summary", "severity", "status", "url"];

export function parseEventInput(raw: unknown): Parsed<EventInput> {
  if (!isObj(raw)) return { ok: false, error: "事件必须是 JSON 对象" };
  const kind = raw.kind ?? "event";
  if (!oneOf(KINDS, kind) || kind === "task") return { ok: false, error: "kind 只能是 metric, event, report (task 走 Agent 接口)" };
  let dataRaw = raw.data;
  if (dataRaw === undefined) dataRaw = Object.fromEntries(SHORTHAND.filter((k) => k in raw).map((k) => [k, raw[k]]));
  if (!isObj(dataRaw)) return { ok: false, error: "data 必须是对象" };
  const data = kind === "metric" ? parseMetric(dataRaw) : kind === "report" ? parseReport(dataRaw) : parseEventData(dataRaw);
  if (typeof data === "string") return { ok: false, error: data };
  const actions = parseActions(raw.actions);
  if (typeof actions === "string") return { ok: false, error: actions };
  if (raw.priority !== undefined && !oneOf(PRIORITIES, raw.priority)) return { ok: false, error: "priority 取值错误" };
  for (const k of ["channel", "subject", "dedupeKey", "groupKey"]) {
    if (!optStr(raw[k], MAX_ID_LENGTH)) return { ok: false, error: `${k} 必须是不超过 128 字的字符串` };
  }
  if (raw.to !== undefined && !(Array.isArray(raw.to) && raw.to.length <= MAX_TARGETS && raw.to.every((x) => typeof x === "string"))) {
    return { ok: false, error: "to 必须是字符串数组" };
  }
  const value: EventInput = { kind, data };
  if (typeof raw.channel === "string" && raw.channel) value.channel = raw.channel;
  if (Array.isArray(raw.to) && raw.to.length) value.to = raw.to as string[];
  if (typeof raw.subject === "string" && raw.subject) value.subject = raw.subject;
  if (raw.priority) value.priority = raw.priority as Priority;
  if (typeof raw.dedupeKey === "string" && raw.dedupeKey) value.dedupeKey = raw.dedupeKey;
  if (typeof raw.groupKey === "string" && raw.groupKey) value.groupKey = raw.groupKey;
  if (actions) value.actions = actions;
  if (typeof raw.ttl === "number" && raw.ttl > 0) value.ttl = Math.floor(raw.ttl);
  if (raw.resolved === true) value.resolved = true;
  if (typeof raw.ts === "number" && raw.ts > 0) value.ts = raw.ts;
  return { ok: true, value };
}

// 更新语义: 服务端对同一来源同一 dedupeKey (以及同一任务) 复用 id, 客户端只需 "同 id 覆盖, 否则追加"
export function mergeEnvelope(list: Envelope[], ev: Envelope): Envelope[] {
  const rest = list.filter((x) => x.id !== ev.id);
  if (ev.deleted?.mode === "delete") return rest;
  rest.push(ev);
  return rest.sort((a, b) => a.seq - b.seq);
}

// 事件组: 同一 groupKey 的关联事件, root 为根因 (组内第一条), 规则只为根因提醒
export type EventGroup = {
  key: string;
  root: string;
  title: string;
  priority: Priority;
  ids: string[];
  count: number;
  open: number;
  first: number;
  last: number;
};

// 外部系统的级别文字归一: error/crit/fatal/down 为紧急, warn 为警告, info/ok/up 为信息
export function severityFromText(v: unknown): Severity | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.toLowerCase();
  if ((SEVERITIES as readonly string[]).includes(s)) return s as Severity;
  if (/(err|crit|fatal|down|fail|emerg|alert)/.test(s)) return "critical";
  if (/warn/.test(s)) return "warning";
  if (/(info|ok|up|resolv|success|recover)/.test(s)) return "info";
  return undefined;
}

// 旧客户端只认文本: 把任何事件压成一行
export function previewOfEnvelope(ev: Envelope): string {
  switch (ev.kind) {
    case "event":
      return ev.data.summary ? `${ev.data.title}: ${ev.data.summary}` : ev.data.title;
    case "report":
      return `[报告] ${ev.data.title}`;
    case "task":
      return `[任务 ${ev.data.state}] ${ev.data.title}`;
    case "metric":
      return Object.entries(ev.data.values).map(([k, v]) => `${k}=${v}`).join(" ");
  }
}
