import { GH_LEGACY_ID, GH_PLUGIN_ID, GH_SERVICE } from "./gh";
import { MAX_TODO_NOTE, PLUGIN_CHANNEL_PREFIX, PLUGIN_SPACE_PREFIX, TODO_PLAN_KEYS, TODO_PRIORITIES, TODO_STATES, isRepoName, planError, type TodoEvery, type TodoGh, type TodoItem, type TodoPriority, type TodoState } from "./plugin";
import type { PDataItem } from "./plugin-api";
import { PERM_DATA_OWN, PLUGIN_API, type FieldType, type PluginExtras } from "./plugin-v2";

// 待办插件 (#101): 旧 id todo 改成 hengxin666.todo, 数据从专用 todo 表搬进 pdata 的 items 集合
export const TODO_PLUGIN = "hengxin666.todo";
export const TODO_LEGACY_ID = "todo";
export const TODO_COLL = "items";
export const MAX_TODO_TITLE = 200;

// 旧 id -> 新 id: 旧客户端和旧书签里的路径照常能用
const ALIASES = new Map([
  [TODO_LEGACY_ID, TODO_PLUGIN],
  [GH_LEGACY_ID, GH_PLUGIN_ID],
]);
// 改过 id 的插件沿用旧 id 的群与工作台 (plugin-todo), 客户端书签与已有群不失效
const SLOTS = new Map([[TODO_PLUGIN, TODO_LEGACY_ID]]);
export const resolvePluginId = (id: string): string => ALIASES.get(id) ?? id;
export const pluginChannel = (id: string): string => `${PLUGIN_CHANNEL_PREFIX}${SLOTS.get(id) ?? id}`;
export const pluginSpaceId = (id: string): string => `${PLUGIN_SPACE_PREFIX}${SLOTS.get(id) ?? id}`;

const STR: FieldType = "string";
const NUM: FieldType = "number";
const OBJ: FieldType = "object";
const BOOL: FieldType = "boolean";
// repo / issue / parent 关联 GitHub issue 与父待办; gh 是服务端同步的 issue 状态; doneAt 是完成时间
export const TODO_FIELDS: Record<string, FieldType> = { channel: STR, title: STR, note: STR, state: STR, prio: NUM, src: NUM, created: NUM, repo: STR, issue: NUM, parent: STR, gh: OBJ, doneAt: NUM,
  // 分区 / 截止 / 提醒 / 周期 / 重点 (#105); runs 与 lastDone 由服务端在周期待办完成时维护
  area: STR, due: NUM, remind: NUM, alarm: BOOL, star: BOOL, every: OBJ, runs: NUM, lastDone: NUM };
// 清单 v2 的数据声明; 迁移旧快照时补上, 与 plugins/hengxin666.todo/plugin.json 一致 (单测校验)
export const TODO_V2: PluginExtras = {
  api: PLUGIN_API,
  engines: { aioa: "^2" },
  optional: { [GH_SERVICE]: "^1" },
  permissions: [PERM_DATA_OWN],
  contributes: { collections: [{ id: TODO_COLL, fields: TODO_FIELDS }] },
  budget: { agentPoll: 0 },
};

// pdata 里的一行待办: id = <群>:<待办 id>, 更新时间用行自带的 updated
export type TodoBody = { channel: string; title: string; note?: string; state: TodoState; prio: TodoPriority; src?: number; created: number; repo?: string; issue?: number; parent?: string; gh?: TodoGh; doneAt?: number;
  area?: string; due?: number; remind?: number; alarm?: boolean; star?: boolean; every?: TodoEvery; runs?: number; lastDone?: number };
export const todoRowId = (channel: string, id: string): string => `${channel}:${id}`;

/** pdata 行转回旧接口的 TodoItem; 墓碑或不属于该群的返回 null。 */
export function todoOf(it: PDataItem, channel?: string): TodoItem | null {
  const b = it.body as TodoBody | undefined;
  if (it.deleted || !b || (channel !== undefined && b.channel !== channel)) return null;
  const prefix = `${b.channel}:`;
  const id = it.id.startsWith(prefix) ? it.id.slice(prefix.length) : it.id;
  const { channel: _c, ...rest } = b;
  return { ...rest, id, updated: it.updated };
}

/** 写进 pdata 的待办行: 字段类型由集合声明校验, 这里再校验取值与 id 前缀。 */
export function checkTodoBody(id: string, raw: unknown): string | null {
  const b = raw as Partial<TodoBody>;
  if (typeof b.channel !== "string" || !b.channel) return "待办需要 channel";
  if (!id.startsWith(`${b.channel}:`)) return "待办 id 必须是 <群>:<待办 id>";
  if (typeof b.title !== "string" || !b.title.trim() || b.title.length > MAX_TODO_TITLE) return `title 为 1 到 ${MAX_TODO_TITLE} 字`;
  if (!(TODO_STATES as readonly unknown[]).includes(b.state)) return `state 只能是 ${TODO_STATES.join("/")}`;
  if (!(TODO_PRIORITIES as readonly unknown[]).includes(b.prio)) return "prio 只能是 1 (急) 2 (普通) 3 (以后)";
  if (b.note != null && b.note.length > MAX_TODO_NOTE) return `note 最多 ${MAX_TODO_NOTE} 字`;
  if (b.src != null && !(Number.isInteger(b.src) && b.src > 0)) return "src 必须是消息 seq";
  if (!Number.isInteger(b.created)) return "待办需要 created (毫秒时间戳)";
  if (b.repo != null && !isRepoName(b.repo)) return "repo 写成 owner/name";
  if (b.issue != null && !(Number.isInteger(b.issue) && b.issue > 0)) return "issue 必须是正整数";
  if (b.parent != null && (typeof b.parent !== "string" || !b.parent || `${b.channel}:${b.parent}` === id)) return "parent 是父待办的 id, 不能是自己";
  if (b.doneAt != null && !Number.isInteger(b.doneAt)) return "doneAt 是毫秒时间戳";
  for (const k of TODO_PLAN_KEYS) {
    const err = planError(k, b[k]);
    if (err) return err;
  }
  if (b.remind != null && b.due == null) return "remind 需要先有 due (截止时间)";
  if (b.every != null && b.due == null) return "every (周期) 需要先有 due (第一期的截止时间)";
  if (b.runs != null && !(Number.isInteger(b.runs) && b.runs >= 0)) return "runs 是非负整数";
  if (b.lastDone != null && !Number.isInteger(b.lastDone)) return "lastDone 是毫秒时间戳";
  return null;
}
