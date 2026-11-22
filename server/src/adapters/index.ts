import {
  PRIORITIES,
  parseEventInput,
  renderTemplate,
  severityFromText,
  type EventInput,
  type HookAdapter,
  type Priority,
  type SourceType,
  type SourceTypeInfo,
} from "@hx-aioa/protocol";
import { github } from "./github";
import { netdata, prometheus } from "./metrics";
import { beszel, healthchecks, uptimeKuma } from "./monitors";
import { type Adapter, type HookInput, INFO, NORMAL, RESOLVED, SUMMARY_PREVIEW, clip, event, isObj } from "./types";

export type { HookInput } from "./types";

const MAPPABLE = ["title", "summary", "severity", "status", "url", "subject", "dedupeKey", "groupKey", "channel", "priority"] as const;

// 通用 Webhook: 有映射按映射; 否则请求体本身是事件就按事件; 再否则整段 JSON 作摘要
export const generic: Adapter = ({ body, source }) => {
  if (source.mapping) {
    const m: Record<string, string> = {};
    for (const k of MAPPABLE) {
      const tpl = source.mapping[k];
      if (tpl === undefined) continue;
      const v = renderTemplate(tpl, body);
      if (v !== undefined && v !== null && v !== "") m[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    const status = m.status ? (/(resolv|ok|up|recover)/i.test(m.status) ? RESOLVED : "firing") : undefined;
    const ex: Partial<EventInput> & { summary?: string; url?: string; status?: "firing" | "resolved" } = {};
    for (const k of ["subject", "dedupeKey", "groupKey", "channel"] as const) if (m[k]) ex[k] = m[k];
    if (m.priority && (PRIORITIES as readonly string[]).includes(m.priority)) ex.priority = m.priority as Priority;
    if (m.summary) ex.summary = m.summary;
    if (m.url) ex.url = m.url;
    if (status) ex.status = status;
    const severity = severityFromText(m.severity) ?? (status === RESOLVED ? INFO : NORMAL);
    return [event(m.title || source.name, severity, ex)];
  }
  if (isObj(body) && (isObj(body.data) || typeof body.title === "string")) {
    const p = parseEventInput(body);
    if (p.ok) return [p.value];
  }
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return [event(source.name, NORMAL, { summary: clip(text, SUMMARY_PREVIEW) })];
};

export const ADAPTERS: Record<HookAdapter, Adapter> = {
  generic,
  github,
  "uptime-kuma": uptimeKuma,
  beszel,
  healthchecks,
  netdata,
  prometheus,
};

// 内置来源类型; 新增一种来源 = 写一个适配器 + 在这里登记, 客户端读 GET /api/v1/source-types 即可展示
export const SOURCE_TYPE_INFOS: SourceTypeInfo[] = [
  { type: "webhook", adapter: "generic", name: "通用 Webhook", icon: "webhook", setup: "任意系统 POST JSON, 可在来源上配置 mapping 映射字段" },
  {
    type: "github",
    adapter: "github",
    name: "GitHub",
    icon: "github",
    setup: "仓库 Settings -> Webhooks, Content type 选 application/json, Secret 填 webhookSecret",
    rules: [{ name: "GitHub 普通动态只进摘要", enabled: true, when: { sources: ["github"], severities: ["info"] }, action: "digest" }],
  },
  {
    type: "uptime-kuma",
    adapter: "uptime-kuma",
    name: "Uptime Kuma",
    icon: "activity",
    setup: "通知类型选 Webhook, 地址填 webhookUrls[\"uptime-kuma\"] 并带 ?key=",
    rules: [{ name: "Uptime Kuma 等待中先不提醒", enabled: true, when: { sources: ["uptime-kuma"], severities: ["warning"] }, action: "aggregate", aggregateSec: 300 }],
  },
  {
    type: "beszel",
    adapter: "beszel",
    name: "Beszel",
    icon: "server",
    setup: "告警: 通知地址用 generic://域名/api/v1/hooks/beszel/{keyId}?key=...; 指标: puller 拉 /api/collections/systems/records, itemsPath 填 items",
  },
  { type: "netdata", adapter: "netdata", name: "Netdata", icon: "activity", setup: "puller 拉 /api/v1/allmetrics?format=json, 来源上填 subject 为主机名" },
  { type: "prometheus", adapter: "prometheus", name: "Prometheus", icon: "chart-line", setup: "puller 拉 /api/v1/query, itemsPath 填 data.result, 查询里用 label_replace 打上 field 标签" },
  { type: "healthchecks", adapter: "healthchecks", name: "Healthchecks", icon: "heart-pulse", setup: "Webhook 集成, 请求体见文档的推荐模板" },
  { type: "agent", name: "Agent", icon: "bot", setup: "用 agent scope 的 key 连 /api/v1/stream?role=agent" },
  { type: "probe", name: "探针", icon: "cpu", setup: "tools/probe.mjs" },
  { type: "script", name: "脚本", icon: "terminal", setup: "POST /api/v1/events 或 /api/v1/messages" },
  { type: "mail", name: "邮件", icon: "mail", setup: "邮件转发服务按通用 Webhook 接入" },
  { type: "pull", name: "拉取任务", icon: "refresh", setup: "家里机器运行 tools/puller.mjs" },
];

export function typeInfo(type: SourceType | string): SourceTypeInfo | undefined {
  return SOURCE_TYPE_INFOS.find((t) => t.type === type || t.adapter === type);
}

// 请求体可能是 JSON, 表单或 GitHub 的 payload= 表单
export function parseHookBody(raw: string, contentType: string, query: URLSearchParams): unknown {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = Object.fromEntries(new URLSearchParams(raw));
    if (typeof form.payload === "string") return safeJson(form.payload) ?? form;
    return form;
  }
  const parsed = raw.trim() ? safeJson(raw) : undefined;
  if (parsed !== undefined) return parsed;
  if (raw.trim()) return raw;
  const fromQuery = Object.fromEntries([...query].filter(([k]) => k !== "key"));
  return fromQuery;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function runAdapter(adapter: HookAdapter, input: HookInput): EventInput[] | string {
  return ADAPTERS[adapter](input);
}
