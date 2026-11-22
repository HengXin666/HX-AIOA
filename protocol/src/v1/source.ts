import { MAX_ID_LENGTH, MAX_TITLE_LENGTH, PRIORITIES, SCOPES, type Priority, type Scope } from "./constants";
import { parseRule, type RuleInput } from "./rule";
import type { JsonMapping } from "./api";

// Webhook 适配器 id, 也是 /api/v1/hooks/{adapter}/{keyId} 的路径段
export const HOOK_ADAPTERS = ["generic", "github", "uptime-kuma", "beszel", "healthchecks"] as const;
export type HookAdapter = (typeof HOOK_ADAPTERS)[number];

export const SOURCE_TYPES = ["webhook", "github", "uptime-kuma", "beszel", "healthchecks", "agent", "probe", "script", "mail", "pull"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

// 内置来源类型的描述: 客户端据此显示 "可接入的来源" 与接入说明, 无需随来源增加而发版
export type SourceTypeInfo = {
  type: SourceType;
  adapter?: HookAdapter;
  name: string;
  icon: string;
  subject?: string;
  channel?: string;
  rules?: RuleInput[];
  setup?: string;
};

export type SourceInput = {
  name: string;
  icon?: string;
  type: SourceType;
  subject?: string;
  channel?: string;
  priority?: Priority;
  mapping?: JsonMapping;
  rules?: RuleInput[];
  callbackUrl?: string;
  key?: { scopes?: Scope[]; ratePerMin?: number };
};

// 拉取式来源的约定: 家里的机器按 job 定时拉取, 每个条目原样 POST 到对应 webhook 适配器, 由服务端统一映射
export type PullJob = {
  id: string;
  url: string;
  everySec: number;
  adapter?: HookAdapter;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  itemsPath?: string;
  keyEnv?: string;
};
export type PullConfig = { server: string; keyId: string; keyEnv: string; jobs: PullJob[] };
export const MIN_PULL_SEC = 60;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const short = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);

export function isHookAdapter(v: unknown): v is HookAdapter {
  return typeof v === "string" && (HOOK_ADAPTERS as readonly string[]).includes(v);
}

export function parseSourceInput(raw: unknown, partial = false): SourceInput | string {
  if (!isObj(raw)) return "来源必须是对象";
  if (!partial && (typeof raw.name !== "string" || !raw.name)) return "需要 name";
  if (!short(raw.name, MAX_TITLE_LENGTH) || !short(raw.icon, MAX_ID_LENGTH)) return "name/icon 过长";
  const type = raw.type ?? "webhook";
  if (!(SOURCE_TYPES as readonly string[]).includes(String(type))) return "type 取值错误";
  for (const k of ["subject", "channel"]) if (!short(raw[k], MAX_ID_LENGTH)) return `${k} 过长`;
  if (raw.priority !== undefined && !(PRIORITIES as readonly string[]).includes(String(raw.priority))) return "priority 取值错误";
  if (raw.callbackUrl !== undefined && !(typeof raw.callbackUrl === "string" && /^https:\/\//.test(raw.callbackUrl))) {
    return "callbackUrl 必须是 https 地址";
  }
  const out: SourceInput = { name: String(raw.name ?? ""), type: type as SourceType };
  if (typeof raw.icon === "string" && raw.icon) out.icon = raw.icon;
  if (typeof raw.subject === "string" && raw.subject) out.subject = raw.subject;
  if (typeof raw.channel === "string" && raw.channel) out.channel = raw.channel;
  if (raw.priority) out.priority = raw.priority as Priority;
  if (typeof raw.callbackUrl === "string") out.callbackUrl = raw.callbackUrl;
  if (raw.mapping !== undefined) {
    if (!isObj(raw.mapping) || !Object.values(raw.mapping).every((v) => typeof v === "string")) return "mapping 必须是字符串映射";
    out.mapping = raw.mapping as JsonMapping;
  }
  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules) || raw.rules.length > 16) return "rules 必须是数组 (最多 16 条)";
    const rules: RuleInput[] = [];
    for (const r of raw.rules) {
      const p = parseRule(r);
      if (typeof p === "string") return `rules: ${p}`;
      rules.push(p);
    }
    out.rules = rules;
  }
  if (raw.key !== undefined) {
    if (!isObj(raw.key)) return "key 必须是对象";
    const scopes = raw.key.scopes;
    if (scopes !== undefined && !(Array.isArray(scopes) && scopes.every((s) => (SCOPES as readonly string[]).includes(String(s))))) {
      return "key.scopes 取值错误";
    }
    out.key = {};
    if (Array.isArray(scopes)) out.key.scopes = scopes as Scope[];
    if (typeof raw.key.ratePerMin === "number" && raw.key.ratePerMin > 0) out.key.ratePerMin = Math.floor(raw.key.ratePerMin);
  }
  return out;
}

// 映射模板: {{a.b.0.c}} 取 JSON 路径, 可混合文字; 只有一个占位符时保留原始类型
export function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (seg === "") continue;
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isObj(cur)) cur = cur[seg];
    else return undefined;
  }
  return cur;
}

const TPL = /\{\{\s*([\w.$-]+)\s*\}\}/g;

export function renderTemplate(tpl: string, obj: unknown): unknown {
  const whole = /^\{\{\s*([\w.$-]+)\s*\}\}$/.exec(tpl);
  if (whole?.[1]) return pick(obj, whole[1]);
  return tpl.replace(TPL, (_, p: string) => {
    const v = pick(obj, p);
    if (v === undefined || v === null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}
