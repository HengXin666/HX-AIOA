import {
  DELIVERY_CHANNELS,
  KINDS,
  PRIORITIES,
  RULE_ACTIONS,
  SEVERITIES,
  type DeliveryChannel,
  type Kind,
  type Priority,
  type RuleAction,
  type Severity,
} from "./constants";

export const DAY_SETS = ["all", "weekday", "weekend"] as const;
export type DaySet = (typeof DAY_SETS)[number];

// 时间窗: HH:MM, start > end 表示跨午夜; 不写表示全天
export type TimeWindow = { start?: string; end?: string; days?: DaySet };

export type RuleWhen = {
  sources?: string[];
  subjects?: string[];
  channels?: string[];
  kinds?: Kind[];
  severities?: Severity[];
  priorities?: Priority[];
  keywords?: string[];
};

export type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  when: RuleWhen;
  window?: TimeWindow;
  action: RuleAction;
  channels?: DeliveryChannel[];
  aggregateSec?: number;
  bypassQuiet?: boolean;
  builtin?: boolean;
};

export type RuleInput = Omit<Rule, "id" | "builtin"> & { id?: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strList = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 32 && v.every((x) => typeof x === "string"));
const inList = (list: readonly string[], v: unknown) =>
  v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string" && list.includes(x)));

export function parseWindow(v: unknown): TimeWindow | string | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) return "window 必须是对象";
  if ((v.start !== undefined && !HHMM.test(String(v.start))) || (v.end !== undefined && !HHMM.test(String(v.end)))) {
    return "window.start/end 必须是 HH:MM";
  }
  if (v.days !== undefined && !(DAY_SETS as readonly string[]).includes(String(v.days))) return "window.days 取值错误";
  const w: TimeWindow = {};
  if (v.start) w.start = String(v.start);
  if (v.end) w.end = String(v.end);
  if (v.days) w.days = v.days as DaySet;
  return w;
}

export function parseRule(raw: unknown): RuleInput | string {
  if (!isObj(raw)) return "规则必须是对象";
  if (typeof raw.name !== "string" || !raw.name) return "需要 name";
  if (typeof raw.action !== "string" || !(RULE_ACTIONS as readonly string[]).includes(raw.action)) return "action 取值错误";
  const when = raw.when ?? {};
  if (!isObj(when)) return "when 必须是对象";
  for (const k of ["sources", "subjects", "channels", "keywords"]) if (!strList(when[k])) return `when.${k} 必须是字符串数组`;
  if (!inList(KINDS, when.kinds)) return "when.kinds 取值错误";
  if (!inList(SEVERITIES, when.severities)) return "when.severities 取值错误";
  if (!inList(PRIORITIES, when.priorities)) return "when.priorities 取值错误";
  if (!inList(DELIVERY_CHANNELS, raw.channels)) return "channels 取值错误";
  const window = parseWindow(raw.window);
  if (typeof window === "string") return window;
  const rule: RuleInput = {
    name: raw.name,
    enabled: raw.enabled !== false,
    when: when as RuleWhen,
    action: raw.action as RuleAction,
  };
  if (typeof raw.id === "string" && raw.id) rule.id = raw.id;
  if (window) rule.window = window;
  if (Array.isArray(raw.channels)) rule.channels = raw.channels as DeliveryChannel[];
  if (typeof raw.aggregateSec === "number" && raw.aggregateSec > 0) rule.aggregateSec = Math.min(raw.aggregateSec, 86_400);
  if (raw.bypassQuiet === true) rule.bypassQuiet = true;
  return rule;
}

// 简单通配: * 匹配任意串
export function globMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(value);
}
