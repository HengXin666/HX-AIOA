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
export type PluginManifest = PluginEntry & {
  readme: string;
  prompt: string;
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
};

// PATCH /api/v1/plugins/{id} 的请求体
export type PluginSettings = { auto: boolean };

// 市场列表: 每项带本机安装状态; error 为拉取市场失败的原因 (已安装的照常返回)
// allowed: 管理员放行的版本; 没放行的也列出来, 方便管理员放行
export type PluginList = { plugins: (PluginEntry & { installed?: PluginInstall; allowed?: PluginAllow })[]; error?: string };
// task: 插件的任务提示词 (已代入群和服务地址, 不含密钥), 可单独复制给任何 Agent; 未安装时按默认群预览
export type PluginDetail = { manifest: PluginManifest; readme: string; readmeType: "markdown" | "html"; installed?: PluginInstall; allowed?: PluginAllow; task?: string; admin?: boolean };
// 安装结果, 只返回这一次: prompt 是一段接入语 (文档链接, 定时任务, 密钥), 整段复制给任何 Agent; key 另给一份方便单独复制
export type PluginInstalled = { install: PluginInstall; prompt: string; key: string };

// 待办: 挂在群下, 群里的 Agent 写, 主人在 App 里勾选
export const TODO_STATES = ["open", "doing", "done", "dropped"] as const;
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
  created: number;
  updated: number;
};
export type TodoInput = { id: string; title?: string; note?: string | null; state?: TodoState; prio?: TodoPriority; src?: number | null };
export type TodoList = { todos: TodoItem[] };

export const PATH_PLUGINS = `${API_V1}/plugins`;
export const PATH_PLUGIN = `${API_V1}/plugins/{id}`;
export const PATH_PLUGIN_INSTALL = `${API_V1}/plugins/{id}/install`;
export const PATH_PLUGIN_UPDATE = `${API_V1}/plugins/{id}/update`;
export const PATH_TODOS = `${API_V1}/chats/{channel}/todos`;
export const PATH_TODO = `${API_V1}/chats/{channel}/todos/{id}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ID_RE = /^[\w.:-]{1,64}$/;

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
