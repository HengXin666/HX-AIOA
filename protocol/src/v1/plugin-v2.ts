import { isRange } from "./semver";

// 清单 v2 (定稿见 docs/design/plugin-arch.md): 只在 v1 字段上加, 不写 api 的旧清单按 "1" 理解
export const PLUGIN_API_LEGACY = "1";
export const PLUGIN_API = "2";
export const PLUGIN_APIS = [PLUGIN_API_LEGACY, PLUGIN_API] as const;
// Agent 定时拉取的最小间隔 (秒); 0 表示用长连, 不拉
export const MIN_AGENT_POLL_S = 60;
// Agent 每轮至少: 建长连或拉消息 1 次, 发结果 1 次, 读写数据 1 次
export const AGENT_ROUND_REQUESTS = 3;
export const SERVICE_PREFIX = "service:";
// 白名单全部插件估算的每天请求上限: 免费额度 10 万的一半
export const PLUGIN_DAILY_BUDGET = 50_000;
export const DAY_S = 86_400;
const MAX_LIST = 64;

// 旧 id: 小写字母数字和 -; 新 id: <GitHub 登录名>.<名字>
const LEGACY_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const NS_ID = /^[a-z0-9](?:[a-z0-9-]{0,38})\.[a-z0-9][a-z0-9-]{0,31}$/;
export const isPluginId = (v: unknown): v is string => typeof v === "string" && (LEGACY_ID.test(v) || NS_ID.test(v));
export const pluginNamespace = (id: string): string | null => (id.includes(".") ? id.split(".")[0]! : null);

export type Cardinality = "single" | "multiple" | "layered" | "pipeline";
// 宿主扩展点目录: 基数决定冲突规则; scoped 表示 id 只在插件内唯一 (如数据集合)
export const EXT_POINTS = {
  commands: { card: "multiple" },
  widgets: { card: "multiple" },
  settings: { card: "layered" },
  collections: { card: "multiple", scoped: true },
  "push.route": { card: "pipeline" },
  "message.beforeSend": { card: "pipeline" },
  "core.theme.base": { card: "single" },
  "core.chat.renderer": { card: "single" },
  "core.push.transport": { card: "single" },
} as const satisfies Record<string, { card: Cardinality; scoped?: boolean }>;
export type ExtPoint = keyof typeof EXT_POINTS;
export const isExtPoint = (v: string): v is ExtPoint => Object.hasOwn(EXT_POINTS, v);
export const cardOf = (p: ExtPoint): Cardinality => EXT_POINTS[p].card;

export const FIELD_TYPES = ["string", "number", "boolean", "object", "array"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type Contribution = {
  id: string;
  title?: string;
  // single: 显式替换的提供者 id; 需要 core.replace 权限
  replaces?: string;
  // pipeline: 顺序与读写字段
  before?: string[];
  after?: string[];
  reads?: string[];
  writes?: string[];
  // settings
  type?: FieldType;
  default?: unknown;
  // collections
  fields?: Record<string, FieldType>;
  index?: string[];
  // widgets: 工作台组件 schema 文件 (插件目录里的相对路径)
  schema?: string;
};

export const PERM_DATA_OWN = "data:own";
export const PERM_PUSH = "push:send";
export const PERM_WEBVIEW = "ui.webview";
export const PERM_REPLACE = "core.replace";
export const PERM_READ_PREFIX = "data:read:";
const PERM_NET_PREFIX = "net:";
const FIXED_PERMS = [PERM_DATA_OWN, PERM_PUSH, PERM_WEBVIEW, PERM_REPLACE];
export const isPermission = (p: unknown): p is string =>
  typeof p === "string" &&
  (FIXED_PERMS.includes(p) || (p.startsWith(PERM_READ_PREFIX) && /^[\w.-]+\.[\w-]+$/.test(p.slice(PERM_READ_PREFIX.length))) || (p.startsWith(PERM_NET_PREFIX) && /^[a-z0-9.*-]+$/.test(p.slice(PERM_NET_PREFIX.length))));
/** 高危权限: 放行与启用时单独确认; 读别的插件的数据也算。 */
export const isRisky = (p: string) => p === PERM_WEBVIEW || p === PERM_REPLACE || p.startsWith(PERM_NET_PREFIX) || p.startsWith(PERM_READ_PREFIX);
/** 只给带服务端代码 (L2a) 的插件的权限。 */
export const isServerPerm = (p: string) => p.startsWith(PERM_NET_PREFIX);

export type PluginBudget = { cron?: string; agentPoll?: number; requestsPerDay?: number };

export type PluginExtras = {
  api?: (typeof PLUGIN_APIS)[number];
  engines?: { aioa: string };
  requires?: Record<string, string>;
  optional?: Record<string, string>;
  provides?: Record<string, string>;
  conflicts?: Record<string, string>;
  contributes?: Partial<Record<ExtPoint, Contribution[]>>;
  emits?: string[];
  listens?: string[];
  permissions?: string[];
  budget?: PluginBudget;
  // 带服务端代码 (L2a): 代码随部署发布, 白名单只能放行这次部署里有的
  server?: boolean;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strList = (v: unknown, re: RegExp) => Array.isArray(v) && v.length <= MAX_LIST && v.every((x) => typeof x === "string" && re.test(x));
const SERVICE_RE = new RegExp(`^${SERVICE_PREFIX}[a-z][\\w.-]{0,63}$`);
const EVENT_RE = /^[\w.-]+\.[\w.-]+$/;
const SHORT_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const CRON_FIELD = /^(\*|\*\/\d+|\d+(-\d+)?(,\d+(-\d+)?)*)$/;
// 分 0-59, 时 0-23, 日 1-31, 月 1-12, 周 0-7; 区间必须从小到大
const CRON_MAX = [59, 23, 31, 12, 7];
function cronField(f: string, max: number): boolean {
  if (!CRON_FIELD.test(f)) return false;
  if (f === "*") return true;
  if (f.startsWith("*/")) return Number(f.slice(2)) >= 1;
  return f.split(",").every((part) => {
    const [a, b] = part.split("-").map(Number);
    return a! <= max && (b === undefined || (a! <= b && b <= max));
  });
}
export const isCron = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  const fs = s.trim().split(/\s+/);
  return fs.length === 5 && fs.every((f, i) => cronField(f, CRON_MAX[i]!));
};

function rangeMap(v: unknown, key: string, keyRe: RegExp): string | null {
  if (v === undefined) return null;
  if (!isObj(v)) return `${key} 必须是对象`;
  for (const [k, r] of Object.entries(v)) {
    if (!keyRe.test(k)) return `${key} 的键 ${k} 不合法`;
    if (!isRange(r)) return `${key}.${k} 的版本范围 ${String(r)} 不合法`;
  }
  return null;
}

function contribution(id: string, point: ExtPoint, c: unknown): string | null {
  if (!isObj(c) || typeof c.id !== "string") return `${point} 的每项都要有 id`;
  const where = `${point}/${c.id}`;
  if ("scoped" in EXT_POINTS[point]) {
    if (!SHORT_RE.test(c.id)) return `${where}: 集合名只能是小写字母开头的字母数字 _ -`;
    if (c.fields !== undefined && !(isObj(c.fields) && Object.values(c.fields).every((t) => (FIELD_TYPES as readonly unknown[]).includes(t)))) return `${where}: fields 的类型只能是 ${FIELD_TYPES.join("/")}`;
    if (c.index !== undefined && !(strList(c.index, SHORT_RE) && (c.index as string[]).length <= 4)) return `${where}: index 最多 4 个字段`;
    return null;
  }
  if (!c.id.startsWith(`${id}.`) || c.id.length > 96) return `${where}: id 必须以插件 id "${id}." 开头`;
  for (const k of ["before", "after", "reads", "writes"] as const) if (c[k] !== undefined && !strList(c[k], /^[\w.:-]{1,96}$/)) return `${where}: ${k} 必须是字符串数组`;
  if (cardOf(point) === "layered" && c.type !== undefined && !(FIELD_TYPES as readonly unknown[]).includes(c.type)) return `${where}: type 不合法`;
  return null;
}

function budget(b: unknown): string | null {
  if (b === undefined) return null;
  if (!isObj(b)) return "budget 必须是对象";
  if (b.cron !== undefined && !isCron(b.cron)) return "budget.cron 必须是 5 段 cron";
  if (b.agentPoll !== undefined && !(b.agentPoll === 0 || (Number.isInteger(b.agentPoll) && (b.agentPoll as number) >= MIN_AGENT_POLL_S))) return `budget.agentPoll 只能是 0 (长连) 或不小于 ${MIN_AGENT_POLL_S} 秒`;
  if (b.requestsPerDay !== undefined && !(Number.isInteger(b.requestsPerDay) && (b.requestsPerDay as number) >= 0)) return "budget.requestsPerDay 必须是非负整数";
  return null;
}

/** v2 附加字段的校验; 返回错误文字, 没问题返回 null。 */
export function checkExtras(raw: Record<string, unknown>): string | null {
  const id = raw.id as string;
  const api = raw.api ?? PLUGIN_API_LEGACY;
  if (!(PLUGIN_APIS as readonly unknown[]).includes(api)) return `api 只能是 ${PLUGIN_APIS.join(" / ")}`;
  if (api === PLUGIN_API_LEGACY) {
    for (const k of ["engines", "requires", "optional", "provides", "conflicts", "contributes", "emits", "listens", "permissions", "budget", "server"]) if (raw[k] !== undefined) return `用 ${k} 需要 "api": "${PLUGIN_API}"`;
    return null;
  }
  if (!isObj(raw.engines) || !isRange(raw.engines.aioa)) return "api 2 需要 engines.aioa 版本范围";
  const agent = (raw.agent ?? {}) as Record<string, unknown>;
  if (agent.interval !== undefined && !(Number.isInteger(agent.interval) && (agent.interval as number) >= MIN_AGENT_POLL_S)) return `agent.interval 不能小于 ${MIN_AGENT_POLL_S} 秒, 更快请用长连 (hxaioa watch)`;
  for (const k of ["requires", "optional", "provides"] as const) {
    const e = rangeMap(raw[k], k, SERVICE_RE);
    if (e) return e;
  }
  const e = rangeMap(raw.conflicts, "conflicts", /^[\w.-]+$/);
  if (e) return e;
  if (raw.contributes !== undefined) {
    if (!isObj(raw.contributes)) return "contributes 必须是对象";
    for (const [p, list] of Object.entries(raw.contributes)) {
      if (!isExtPoint(p)) return `没有扩展点 ${p}, 可用: ${Object.keys(EXT_POINTS).join(", ")}`;
      if (!Array.isArray(list) || list.length > MAX_LIST) return `contributes.${p} 必须是数组`;
      const seen = new Set<string>();
      for (const c of list) {
        const ce = contribution(id, p, c);
        if (ce) return ce;
        const cid = (c as Contribution).id;
        if (seen.has(cid)) return `${p}/${cid} 重复`;
        seen.add(cid);
      }
      if (cardOf(p) === "single" && !((raw.permissions as unknown[] | undefined) ?? []).includes(PERM_REPLACE)) return `替换核心扩展点 ${p} 需要权限 ${PERM_REPLACE}`;
    }
  }
  if (raw.emits !== undefined && !(strList(raw.emits, EVENT_RE) && (raw.emits as string[]).every((ev) => ev.startsWith(`${id}.`)))) return `emits 的事件名必须以 "${id}." 开头`;
  if (raw.listens !== undefined && !strList(raw.listens, EVENT_RE)) return "listens 必须是事件名数组";
  if (raw.permissions !== undefined && !(Array.isArray(raw.permissions) && raw.permissions.every(isPermission))) return "permissions 里有不认识的权限";
  if (raw.server !== undefined && typeof raw.server !== "boolean") return "server 只能是 true / false";
  const net = ((raw.permissions as string[] | undefined) ?? []).find(isServerPerm);
  if (net && raw.server !== true) return `${net} 只给带服务端代码的插件 ("server": true)`;
  return budget(raw.budget);
}
