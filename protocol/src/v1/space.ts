import { ITEM_TYPES, MAX_ID_LENGTH, MAX_TITLE_LENGTH, type ItemType } from "./constants";

export const MAX_PANELS = 20;
export const MAX_ITEMS = 24;
export const MAX_BINDS = 16;
export const MIN_INTERVAL_SEC = 60;
export const MAX_SPACE_BYTES = 32_000;
export const MAX_QUESTION_LENGTH = 120;
export const PANEL_SIZES = ["s", "m", "l", "full"] as const;
export type PanelSize = (typeof PANEL_SIZES)[number];

// 组件分类: 指标, 状态, 列表, 交互, 动作, 阅读; 两端按同一张表渲染
export const ITEM_CATEGORIES = ["metric", "status", "list", "interaction", "action", "reading"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const CATEGORY_OF: Record<ItemType, ItemCategory> = {
  value: "metric",
  sparkline: "metric",
  line: "metric",
  ring: "metric",
  status_grid: "status",
  list: "list",
  task_card: "list",
  chat: "interaction",
  approval: "interaction",
  button: "action",
  report: "reading",
  todo: "list",
};
// 这些组件读指标, 必须绑定; 图表还必须写明它回答什么问题
export const BIND_REQUIRED: readonly ItemType[] = ["value", "sparkline", "line", "ring", "status_grid"];
export const QUESTION_REQUIRED: readonly ItemType[] = ["sparkline", "line", "ring"];
export const RANGE_PATTERN = /^\d+[smhd]$/;

// 数据绑定: 来源无关, 只按 subject + 标准 field 取值; source 只是声明期望的采集器, 不参与匹配
export type Bind = { subject: string; field: string; source?: string; range?: string };
export type ButtonAction = { agent: string; command: string; args?: Record<string, unknown>; danger?: boolean };
export type Item = {
  id: string;
  type: ItemType;
  title?: string;
  icon?: string;
  question?: string;
  bind?: Bind[];
  props?: Record<string, unknown>;
  action?: ButtonAction;
};
export type Refresh = { mode: "push" } | { mode: "interval"; everySec: number };
export type Panel = {
  id: string;
  title: string;
  icon?: string;
  size?: PanelSize;
  refresh: Refresh;
  items: Item[];
};
// 对顶部标签的提示 (#139): primary 优先补空位 (只给可信来源的插件), auto 缺省, none 从不自动置顶; 用户设过的永远优先
export const SPACE_TABS = ["primary", "auto", "none"] as const;
export type SpaceTab = (typeof SPACE_TABS)[number];
export const isSpaceTab = (v: unknown): v is SpaceTab => (SPACE_TABS as readonly unknown[]).includes(v);
export type Space = {
  id: string;
  title: string;
  icon?: string;
  origin?: string;
  tab?: SpaceTab;
  updated?: number;
  panels: Panel[];
  state?: SpaceState;
};
// 用户自己的显示状态: 隐藏, 置顶到顶部标签 (客户端限 5 个, 没设过按 tab 提示补空位; PUT 时 null 表示清掉), 自选图标 (#142, 见 isIconRef), 排序, 尺寸; 与布局分开存, Agent 重新下发不覆盖
export type SpaceState = { hidden?: boolean; pinned?: boolean; icon?: string; hiddenPanels?: string[]; order?: string[]; sizes?: Record<string, PanelSize> };
export type SpaceWithState = Space & { state: SpaceState };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idOk = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH && /^[\w.:-]+$/.test(v);
const titleOk = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_TITLE_LENGTH;
const optStr = (v: unknown) => v === undefined || typeof v === "string";
export const isPanelSize = (v: unknown): v is PanelSize => (PANEL_SIZES as readonly unknown[]).includes(v);

function checkBind(b: unknown, at: string, errs: string[]): void {
  if (!isObj(b) || typeof b.subject !== "string" || !b.subject || typeof b.field !== "string" || !b.field) {
    return void errs.push(`${at}: bind 需要 subject 与 field`);
  }
  if (b.range !== undefined && !(typeof b.range === "string" && RANGE_PATTERN.test(b.range))) {
    errs.push(`${at}: range 格式为 数字 + s/m/h/d, 如 10m`);
  }
  if (!(b.source === undefined || idOk(b.source))) errs.push(`${at}: source 格式错误`);
}

function checkItem(it: unknown, at: string, errs: string[]): void {
  if (!isObj(it)) return void errs.push(`${at}: 必须是对象`);
  if (!idOk(it.id)) errs.push(`${at}: id 只能包含字母数字和 _ . : -`);
  const type = String(it.type);
  if (!(ITEM_TYPES as readonly string[]).includes(type)) errs.push(`${at}: 未知组件类型 ${type}`);
  if (!optStr(it.title) || !optStr(it.icon)) errs.push(`${at}: title/icon 必须是字符串`);
  if (it.bind !== undefined) {
    if (!Array.isArray(it.bind) || it.bind.length > MAX_BINDS) errs.push(`${at}: bind 必须是数组 (最多 ${MAX_BINDS} 个)`);
    else it.bind.forEach((b, i) => checkBind(b, `${at}.bind[${i}]`, errs));
  }
  if (BIND_REQUIRED.includes(type as ItemType) && !(Array.isArray(it.bind) && it.bind.length)) {
    errs.push(`${at}: ${type} 需要至少一个 bind`);
  }
  const q = it.question;
  if (q !== undefined && !(typeof q === "string" && q.length > 0 && q.length <= MAX_QUESTION_LENGTH)) {
    errs.push(`${at}: question 必须是 1 到 ${MAX_QUESTION_LENGTH} 字的字符串`);
  } else if (q === undefined && QUESTION_REQUIRED.includes(type as ItemType)) {
    errs.push(`${at}: 图表 ${type} 需要 question, 写明它回答什么问题`);
  }
  if (it.props !== undefined && !isObj(it.props)) errs.push(`${at}: props 必须是对象`);
  if (type === "button") {
    const a = it.action;
    if (!isObj(a) || typeof a.agent !== "string" || typeof a.command !== "string") {
      errs.push(`${at}: button 需要 action.agent 与 action.command`);
    }
  }
}

function checkRefresh(r: unknown, at: string, errs: string[]): void {
  if (!isObj(r)) return void errs.push(`${at}: 需要 refresh`);
  if (r.mode === "push") return;
  if (r.mode === "interval" && typeof r.everySec === "number" && r.everySec >= MIN_INTERVAL_SEC) return;
  errs.push(`${at}: refresh 必须是 {mode:"push"} 或 {mode:"interval", everySec>=${MIN_INTERVAL_SEC}}`);
}

// 返回全部错误, 方便 Agent 一次改完
export function validateSpace(raw: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(raw)) return ["space 必须是对象"];
  if (JSON.stringify(raw).length > MAX_SPACE_BYTES) errs.push("space 过大 (上限 32KB)");
  if (!idOk(raw.id)) errs.push("id 只能包含字母数字和 _ . : -");
  if (!titleOk(raw.title)) errs.push("需要 title");
  if (raw.tab !== undefined && !isSpaceTab(raw.tab)) errs.push(`tab 只能是 ${SPACE_TABS.join("/")}`);
  if (!Array.isArray(raw.panels) || raw.panels.length > MAX_PANELS) return [...errs, `panels 必须是数组 (最多 ${MAX_PANELS} 个)`];
  const ids = new Set<string>();
  const itemIds = new Set<string>();
  raw.panels.forEach((p, i) => {
    const at = `panels[${i}]`;
    if (!isObj(p)) return void errs.push(`${at}: 必须是对象`);
    if (!idOk(p.id)) errs.push(`${at}: id 格式错误`);
    else if (ids.has(p.id)) errs.push(`${at}: id 重复`);
    else ids.add(p.id);
    if (!titleOk(p.title)) errs.push(`${at}: 需要 title`);
    if (p.size !== undefined && !isPanelSize(p.size)) errs.push(`${at}: size 只能是 ${PANEL_SIZES.join("/")}`);
    checkRefresh(p.refresh, at, errs);
    if (!Array.isArray(p.items) || p.items.length > MAX_ITEMS) return void errs.push(`${at}: items 必须是数组 (最多 ${MAX_ITEMS} 个)`);
    p.items.forEach((it, j) => {
      checkItem(it, `${at}.items[${j}]`, errs);
      // 按钮按 spaceId + itemId 找动作, 组件 id 在整个工作台内必须唯一
      if (isObj(it) && idOk(it.id)) {
        if (itemIds.has(it.id)) errs.push(`${at}.items[${j}]: 组件 id ${it.id} 在工作台内重复`);
        itemIds.add(it.id);
      }
    });
  });
  return errs;
}

// 不可信的来源 (第三方源, 开发模式, Agent 下发) 不能声明 primary, 降为 auto; 其余原样返回
export function demoteTab<T>(raw: T): T {
  return isObj(raw) && raw.tab === "primary" ? { ...raw, tab: "auto" } : raw;
}
