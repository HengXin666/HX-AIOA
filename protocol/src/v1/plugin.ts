import { API_V1 } from "./constants";
import type { Space } from "./space";

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
  agent: { name: string; schedule?: string };
  space?: Space;
};

export type PluginInstall = {
  id: string;
  version: string;
  name: string;
  channel: string;
  space?: string;
  keyId: string;
  installed: number;
};

// 市场列表: 每项带本机安装状态; error 为拉取市场失败的原因 (已安装的照常返回)
export type PluginList = { plugins: (PluginEntry & { installed?: PluginInstall })[]; error?: string };
// task: 插件的任务提示词 (已代入群和服务地址, 不含密钥), 可单独复制给任何 Agent; 未安装时按默认群预览
export type PluginDetail = { manifest: PluginManifest; readme: string; readmeType: "markdown" | "html"; installed?: PluginInstall; task?: string };
// 安装结果, 只返回这一次: prompt 是给本地 Agent (Claude Code 等) 的接入语, 含密钥;
// request 是给云端 Agent (Hark 等) 的委托语, 规则内联, 不含密钥; key 单独给, 存进对方的密钥保管处
export type PluginInstalled = { install: PluginInstall; prompt: string; request: string; key: string };

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
export const PATH_TODOS = `${API_V1}/chats/{channel}/todos`;
export const PATH_TODO = `${API_V1}/chats/{channel}/todos/{id}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ID_RE = /^[\w.:-]{1,64}$/;
export const isPluginId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(v);

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
  if (!isPluginId(raw.id)) return "id 只能是小写字母数字和 -";
  for (const k of ["name", "summary", "version", "readme", "prompt"] as const) {
    if (typeof raw[k] !== "string" || !raw[k]) return `缺少 ${k}`;
  }
  if (!/^[\w.-]+\.(md|html)$/.test(raw.readme as string)) return "readme 必须是插件目录里的 .md 或 .html 文件";
  if (!/^[\w.-]+\.md$/.test(raw.prompt as string)) return "prompt 必须是插件目录里的 .md 文件";
  if (!isObj(raw.group) || typeof raw.group.title !== "string" || !raw.group.title) return "缺少 group.title";
  if (!isObj(raw.agent) || typeof raw.agent.name !== "string" || !raw.agent.name) return "缺少 agent.name";
  if (raw.space !== undefined && !isObj(raw.space)) return "space 必须是工作台布局对象";
  return raw as unknown as PluginManifest;
}
