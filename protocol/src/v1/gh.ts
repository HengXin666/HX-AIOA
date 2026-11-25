import { API_V1 } from "./constants";

// GitHub 授权 (无 Agent 插件 hengxin666.gh, 旧 id gh): 主人授权一次, 令牌只在服务端; 别的插件和获准的 Agent 通过服务端代办 issue 操作
export const GH_PLUGIN_ID = "hengxin666.gh";
export const GH_LEGACY_ID = "gh";
// 插件清单在 requires / optional 里声明这个服务, 它的 Agent 默认可以经服务端代办 issue
export const GH_SERVICE = "service:gh.issues";
export const GH_AUTH_KINDS = ["oauth", "pat"] as const;
export type GhAuthKind = (typeof GH_AUTH_KINDS)[number];
export const GH_MAX_OPS = 50;

export type GhAuth = { login: string; kind: GhAuthKind; since: number; expires?: number };
// 仓库范围的快捷规则; repos 手动加, deny 手动排除, 优先级 deny > repos > 规则
export type GhRules = { pushedDays?: number; public?: boolean; private?: boolean; repos?: string[]; deny?: string[] };
export type GhRepo = { repo: string; private: boolean; pushed: number; allowed: boolean };
export type GhAgent = { keyId: string; name: string; channel: string; allowed: boolean; dep: boolean };
export type GhOp = { ts: number; by: string; op: string; repo: string; issue?: number; ok: boolean; note?: string };
// device: 服务端配了 GH_CLIENT_ID, 能走设备码授权
export type GhStatus = { auth?: GhAuth; rules: GhRules; device: boolean; agents: GhAgent[]; ops: GhOp[] };
export type GhDevice = { id: string; userCode: string; verifyUrl: string; expires: number; interval: number };
export type GhDevicePoll = { status: "pending" | "done" | "expired" | "denied"; auth?: GhAuth };
export type GhIssue = { repo: string; number: number; title: string; state: "open" | "closed"; url: string; comments: number; parent?: number; updated: number };
export type GhIssueInput = { title: string; body?: string; parent?: number; labels?: string[]; todo?: { channel: string; id: string } };
export type GhIssuePatch = { state?: "open" | "closed"; title?: string; body?: string; labels?: string[] };

export const PATH_GH = `${API_V1}/gh`;
export const PATH_GH_TOKEN = `${API_V1}/gh/token`;
export const PATH_GH_DEVICE = `${API_V1}/gh/device`;
export const PATH_GH_DEVICE_POLL = `${API_V1}/gh/device/{id}`;
export const PATH_GH_REPOS = `${API_V1}/gh/repos`;
export const PATH_GH_RULES = `${API_V1}/gh/rules`;
export const PATH_GH_AGENT = `${API_V1}/gh/agents/{keyId}`;
export const PATH_GH_ISSUES = `${API_V1}/gh/issues/{owner}/{name}`;
export const PATH_GH_ISSUE = `${API_V1}/gh/issues/{owner}/{name}/{number}`;
export const PATH_GH_COMMENTS = `${API_V1}/gh/issues/{owner}/{name}/{number}/comments`;
export const PATH_GH_SUB = `${API_V1}/gh/issues/{owner}/{name}/{number}/sub`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length <= 140);

export function parseGhRules(raw: unknown): GhRules | string {
  if (!isObj(raw)) return "规则必须是对象";
  const out: GhRules = {};
  if (raw.pushedDays !== undefined && raw.pushedDays !== null) {
    if (!(typeof raw.pushedDays === "number" && Number.isInteger(raw.pushedDays) && raw.pushedDays > 0 && raw.pushedDays <= 3650)) return "pushedDays 为 1 到 3650 天";
    out.pushedDays = raw.pushedDays;
  }
  for (const k of ["public", "private"] as const) {
    if (raw[k] !== undefined && typeof raw[k] !== "boolean") return `${k} 是布尔值`;
    if (raw[k] === true) out[k] = true;
  }
  for (const k of ["repos", "deny"] as const) {
    if (raw[k] === undefined) continue;
    if (!strList(raw[k]) || (raw[k] as string[]).length > 300) return `${k} 是仓库名数组`;
    out[k] = [...new Set(raw[k] as string[])];
  }
  return out;
}

export function parseGhIssueInput(raw: unknown): GhIssueInput | string {
  if (!isObj(raw) || typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 256) return "title 为 1 到 256 字";
  const out: GhIssueInput = { title: raw.title.trim() };
  if (raw.body !== undefined) {
    if (typeof raw.body !== "string" || raw.body.length > 60_000) return "body 最多 60000 字";
    out.body = raw.body;
  }
  if (raw.parent !== undefined) {
    if (!(typeof raw.parent === "number" && Number.isInteger(raw.parent) && raw.parent > 0)) return "parent 是父 issue 号";
    out.parent = raw.parent;
  }
  if (raw.labels !== undefined) {
    if (!strList(raw.labels)) return "labels 是字符串数组";
    out.labels = raw.labels as string[];
  }
  if (raw.todo !== undefined) {
    if (!isObj(raw.todo) || typeof raw.todo.channel !== "string" || typeof raw.todo.id !== "string") return "todo 是 { channel, id }";
    out.todo = { channel: raw.todo.channel, id: raw.todo.id };
  }
  return out;
}

export function parseGhIssuePatch(raw: unknown): GhIssuePatch | string {
  if (!isObj(raw)) return "必须是对象";
  const out: GhIssuePatch = {};
  if (raw.state !== undefined) {
    if (raw.state !== "open" && raw.state !== "closed") return "state 只能是 open / closed";
    out.state = raw.state;
  }
  if (raw.title !== undefined) {
    if (typeof raw.title !== "string" || !raw.title.trim()) return "title 不能为空";
    out.title = raw.title.trim();
  }
  if (raw.body !== undefined) {
    if (typeof raw.body !== "string") return "body 是字符串";
    out.body = raw.body;
  }
  if (raw.labels !== undefined) {
    if (!strList(raw.labels)) return "labels 是字符串数组";
    out.labels = raw.labels as string[];
  }
  return Object.keys(out).length ? out : "没有要改的字段";
}
