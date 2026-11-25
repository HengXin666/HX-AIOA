import { API_V1 } from "./constants";
import type { Space } from "./space";
import type { PluginAllow } from "./plugin-api";
import { PLUGIN_API_LEGACY, checkExtras, isPluginId, type PluginExtras } from "./plugin-v2";

export { isPluginId };

// 插件 = 一个群 + 一个 Agent (提示词模板) + 一份工作台布局, 不在设备上执行任何代码
// 市场是仓库里的 plugins/ 目录: index.json 列出插件, 每个插件一个目录 (plugin.json, 介绍, 提示词)
export const PLUGIN_INDEX_FILE = "index.json";
export const PLUGIN_MANIFEST_FILE = "plugin.json";
export const PLUGIN_CHANNEL_PREFIX = "plugin-";
export const PLUGIN_SPACE_PREFIX = "plugin-";
// 模板占位符: 安装时替换成这个插件实例的群和服务地址
export const PLUGIN_VAR_CHANNEL = "{{channel}}";
export const PLUGIN_VAR_TITLE = "{{title}}";
export const PLUGIN_VAR_BASE = "{{base}}";
export const MAX_PLUGIN_TEXT = 32_000;
export const MAX_PLUGINS = 24;

export type PluginEntry = {
  id: string;
  name: string;
  summary: string;
  version: string;
  icon?: string;
  tags?: string[];
  author?: string;
};
export type PluginIndex = { plugins: PluginEntry[] };

// readme 与 prompt 是插件目录里的相对文件名; readme 可以是 .md 或 .html
// 依赖: optional 为真时没装也能用, 只是少了相关功能
export type PluginDep = { id: string; optional?: boolean };
// base 插件 (如 GitHub 授权) 不建群不带 Agent, 只提供能力给别的插件用
export type PluginManifest = PluginEntry & {
  readme: string;
  prompt: string;
  base?: boolean;
  deps?: PluginDep[];
  group: { title: string };
  // interval: 建议的定时 (秒); task: 一句话任务, 写进接入语, 详细规则在专属指令里; api 2 可以不要 Agent (只启用, 不安装)
  agent?: PluginAgent;
  space?: Space;
} & PluginExtras;

export type PluginAgent = { name: string; schedule?: string; interval?: number; task?: string };

export type PluginInstall = {
  id: string;
  version: string;
  name: string;
  channel: string;
  space?: string;
  keyId: string;
  installed: number;
  // 上次更新时间; 没更新过就没有
  updated?: number;
  // 自动更新, 缺省为开: 市场版本变了就在下次打开市场或 Agent 拉指令时换成新版
  auto?: boolean;
  // 声明的依赖插件 id; base 插件的 channel 与 keyId 为空
  deps?: string[];
  base?: boolean;
};

// PATCH /api/v1/plugins/{id} 的请求体
export type PluginSettings = { auto: boolean };

// 市场列表: 每项带本机安装状态; error 为拉取市场失败的原因 (已安装的照常返回)
// allowed: 管理员放行的版本; 没放行的也列出来, 方便管理员放行
// enabled: 本账号启用了 (无 Agent 的插件没有安装记录, 靠这个归到 "已安装")
export type PluginList = { plugins: (PluginEntry & { installed?: PluginInstall; allowed?: PluginAllow; enabled?: true })[]; error?: string };
// task: 插件的任务提示词 (已代入群和服务地址, 不含密钥), 可单独复制给任何 Agent; 未安装时按默认群预览
export type PluginDetail = { manifest: PluginManifest; readme: string; readmeType: "markdown" | "html"; installed?: PluginInstall; allowed?: PluginAllow; task?: string; admin?: boolean };
// 安装结果, 只返回这一次: prompt 是一段接入语 (文档链接, 定时任务, 密钥), 整段复制给任何 Agent; key 另给一份方便单独复制
export type PluginInstalled = { install: PluginInstall; prompt: string; key: string };

// 待办: 挂在群下, 群里的 Agent 写, 主人在 App 里勾选
// open 待进行, hold 挂起, doing 进行中, done 已完成; dropped 是旧数据的放弃, 界面按已完成划掉
export const TODO_STATES = ["open", "hold", "doing", "done", "dropped"] as const;
export type TodoState = (typeof TODO_STATES)[number];
export const TODO_PRIORITIES = [1, 2, 3] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];
export const MAX_TODOS = 500;
export const MAX_TODO_NOTE = 2000;
export const MAX_TODO_BATCH = 50;
export const TODO_SYNC_TOPIC = "todos";

export type TodoItem = {
  id: string;
  title: string;
  note?: string;
  state: TodoState;
  prio: TodoPriority;
  // 来源消息的 seq, 客户端点它跳回原消息
  src?: number;
  // 关联的仓库 (owner/name) 与 issue 号; parent 是父待办的 id, 用于树形展示
  repo?: string;
  issue?: number;
  parent?: string;
  // 服务端从 GitHub 同步的 issue 状态, 只读
  gh?: TodoGh;
  created: number;
  updated: number;
  // 进入 done 的时间
  doneAt?: number;
};
export type TodoGh = { state: "open" | "closed"; comments: number; parent?: number; subs?: number; title?: string; synced: number };
export type TodoInput = {
  id: string;
  title?: string;
  note?: string | null;
  state?: TodoState;
  prio?: TodoPriority;
  src?: number | null;
  repo?: string | null;
  issue?: number | null;
  parent?: string | null;
};
export type TodoList = { todos: TodoItem[] };

export const PATH_PLUGINS = `${API_V1}/plugins`;
export const PATH_PLUGIN = `${API_V1}/plugins/{id}`;
export const PATH_PLUGIN_INSTALL = `${API_V1}/plugins/{id}/install`;
export const PATH_PLUGIN_UPDATE = `${API_V1}/plugins/{id}/update`;
export const PATH_TODOS = `${API_V1}/chats/{channel}/todos`;
export const PATH_TODO = `${API_V1}/chats/{channel}/todos/{id}`;
export const PATH_TODOS_SYNC = `${API_V1}/chats/{channel}/todos-sync`;

// 外部接入: 给别的 AI 一把只能碰这个群待办的密钥, 默认 24 小时过期
export const EXT_ACCESS = ["read", "write"] as const;
export type ExtAccess = (typeof EXT_ACCESS)[number];
export const EXT_TTL_HOURS = 24;
export const EXT_MAX_HOURS = 24 * 90;
export type ExtKeyInfo = { id: string; name: string; access: ExtAccess; prefix: string; created: number; expires?: number; used?: number };
// hours 为 0 表示不过期
export type ExtKeyRequest = { name: string; access: ExtAccess; hours?: number };
export type ExtKeyCreated = { info: ExtKeyInfo; key: string; mcp: string; md: string };
export const PATH_TODO_EXT = `${API_V1}/chats/{channel}/todos-ext`;
export const PATH_TODO_EXT_ONE = `${API_V1}/chats/{channel}/todos-ext/{id}`;
export const PATH_EXT_MCP = `${API_V1}/ext/mcp`;
export const PATH_EXT_MD = `${API_V1}/ext/todos.md`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ID_RE = /^[\w.:-]{1,64}$/;
export const isRepoName = (v: unknown): v is string => typeof v === "string" && /^[\w.-]{1,39}\/[\w.-]{1,100}$/.test(v);

// 单条待办的增量: 只校验出现的字段, 新建时由服务端要求 title
export function parseTodoInput(raw: unknown): TodoInput | string {
  if (!isObj(raw)) return "待办必须是对象";
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return "id 只能包含字母数字和 _ . : -, 最多 64 字";
  const out: TodoInput = { id: raw.id };
  if (raw.title !== undefined) {
    if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 200) return "title 为 1 到 200 字";
    out.title = raw.title.trim();
  }
  if (raw.note !== undefined) {
    if (raw.note !== null && !(typeof raw.note === "string" && raw.note.length <= MAX_TODO_NOTE)) return `note 最多 ${MAX_TODO_NOTE} 字`;
    out.note = raw.note as string | null;
  }
  if (raw.state !== undefined) {
    if (!(TODO_STATES as readonly unknown[]).includes(raw.state)) return `state 只能是 ${TODO_STATES.join("/")}`;
    out.state = raw.state as TodoState;
  }
  if (raw.prio !== undefined) {
    if (!(TODO_PRIORITIES as readonly unknown[]).includes(raw.prio)) return "prio 只能是 1 (急) 2 (普通) 3 (以后)";
    out.prio = raw.prio as TodoPriority;
  }
  if (raw.repo !== undefined) {
    if (raw.repo !== null && !isRepoName(raw.repo)) return "repo 写成 owner/name";
    out.repo = raw.repo as string | null;
  }
  if (raw.issue !== undefined) {
    if (raw.issue !== null && !(typeof raw.issue === "number" && Number.isInteger(raw.issue) && raw.issue > 0)) return "issue 必须是正整数";
    out.issue = raw.issue as number | null;
  }
  if (raw.parent !== undefined) {
    if (raw.parent !== null && !(typeof raw.parent === "string" && ID_RE.test(raw.parent))) return "parent 是父待办的 id";
    if (raw.parent === raw.id) return "parent 不能是自己";
    out.parent = raw.parent as string | null;
  }
  if (raw.src !== undefined) {
    if (raw.src !== null && !(typeof raw.src === "number" && Number.isInteger(raw.src) && raw.src > 0)) return "src 必须是消息 seq";
    out.src = raw.src as number | null;
  }
  return out;
}

// 市场的 plugin.json: 字段不全或格式不对就不让装
export function parseManifest(raw: unknown): PluginManifest | string {
  if (!isObj(raw)) return "plugin.json 必须是对象";
  if (!isPluginId(raw.id)) return "id 只能是 <GitHub 登录名>.<名字> (旧插件为小写字母数字和 -)";
  for (const k of ["name", "summary", "version", "readme", "prompt"] as const) {
    if (typeof raw[k] !== "string" || !raw[k]) return `缺少 ${k}`;
  }
  if (!/^[\w.-]+\.(md|html)$/.test(raw.readme as string)) return "readme 必须是插件目录里的 .md 或 .html 文件";
  if (!/^[\w.-]+\.md$/.test(raw.prompt as string)) return "prompt 必须是插件目录里的 .md 文件";
  if (raw.deps !== undefined && !(Array.isArray(raw.deps) && raw.deps.every((d) => isObj(d) && isPluginId(d.id)))) return "deps 是 [{ id, optional }]";
  // base 插件 (旧格式) 不建群不带 Agent: 补上群标题, 不补 Agent, 按无 Agent 插件处理 (只启用不安装)
  if (raw.base === true) return { ...raw, group: { title: String(raw.name) } } as unknown as PluginManifest;
  if (!isObj(raw.group) || typeof raw.group.title !== "string" || !raw.group.title) return "缺少 group.title";
  // 旧清单 (api 1) 就是 "群 + Agent", 必须有 Agent; api 2 的 Agent 可选
  if (raw.agent !== undefined || (raw.api ?? PLUGIN_API_LEGACY) === PLUGIN_API_LEGACY) {
    if (!isObj(raw.agent) || typeof raw.agent.name !== "string" || !raw.agent.name) return "缺少 agent.name";
  }
  if (raw.space !== undefined && !isObj(raw.space)) return "space 必须是工作台布局对象";
  const extra = checkExtras(raw);
  if (extra) return extra;
  return raw as unknown as PluginManifest;
}
