import { ITEM_TYPES, MAX_ID_LENGTH, MAX_TITLE_LENGTH, type ItemType } from "./constants";

export const MAX_PANELS = 20;
export const MAX_ITEMS = 24;
export const MAX_BINDS = 16;
export const MIN_INTERVAL_SEC = 60;
export const MAX_SPACE_BYTES = 32_000;
export const PANEL_SIZES = ["s", "m", "l", "full"] as const;
export type PanelSize = (typeof PANEL_SIZES)[number];

// 组件只订阅 subject + field, 不自己拉数据
export type Bind = { subject: string; field: string; source?: string; range?: string };
export type ButtonAction = { agent: string; command: string; args?: Record<string, unknown>; danger?: boolean };
export type Item = {
  id: string;
  type: ItemType;
  title?: string;
  icon?: string;
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
export type Space = {
  id: string;
  title: string;
  icon?: string;
  origin?: string;
  updated?: number;
  panels: Panel[];
};
export type SpaceState = { hidden?: boolean; hiddenPanels?: string[]; order?: string[] };
export type SpaceWithState = Space & { state: SpaceState };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idOk = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH && /^[\w.:-]+$/.test(v);
const titleOk = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_TITLE_LENGTH;
const optStr = (v: unknown) => v === undefined || typeof v === "string";

function checkBind(b: unknown, at: string, errs: string[]): void {
  if (!isObj(b) || typeof b.subject !== "string" || !b.subject || typeof b.field !== "string" || !b.field) {
    errs.push(`${at}: bind 需要 subject 与 field`);
  }
}

function checkItem(it: unknown, at: string, errs: string[]): void {
  if (!isObj(it)) return void errs.push(`${at}: 必须是对象`);
  if (!idOk(it.id)) errs.push(`${at}: id 只能包含字母数字和 _ . : -`);
  if (typeof it.type !== "string" || !(ITEM_TYPES as readonly string[]).includes(it.type)) {
    errs.push(`${at}: 未知组件类型 ${String(it.type)}`);
  }
  if (!optStr(it.title) || !optStr(it.icon)) errs.push(`${at}: title/icon 必须是字符串`);
  if (it.bind !== undefined) {
    if (!Array.isArray(it.bind) || it.bind.length > MAX_BINDS) errs.push(`${at}: bind 必须是数组 (最多 16 个)`);
    else it.bind.forEach((b, i) => checkBind(b, `${at}.bind[${i}]`, errs));
  }
  const needsBind = ["value", "sparkline", "line", "ring", "status_grid"];
  if (needsBind.includes(String(it.type)) && !(Array.isArray(it.bind) && it.bind.length)) {
    errs.push(`${at}: ${String(it.type)} 需要至少一个 bind`);
  }
  if (it.props !== undefined && !isObj(it.props)) errs.push(`${at}: props 必须是对象`);
  if (it.type === "button") {
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
  errs.push(`${at}: refresh 必须是 {mode:"push"} 或 {mode:"interval", everySec>=60}`);
}

// 返回全部错误, 方便 Agent 一次改完
export function validateSpace(raw: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(raw)) return ["space 必须是对象"];
  if (JSON.stringify(raw).length > MAX_SPACE_BYTES) errs.push("space 过大 (上限 32KB)");
  if (!idOk(raw.id)) errs.push("id 只能包含字母数字和 _ . : -");
  if (!titleOk(raw.title)) errs.push("需要 title");
  if (!Array.isArray(raw.panels) || raw.panels.length > MAX_PANELS) return [...errs, "panels 必须是数组 (最多 20 个)"];
  const ids = new Set<string>();
  raw.panels.forEach((p, i) => {
    const at = `panels[${i}]`;
    if (!isObj(p)) return void errs.push(`${at}: 必须是对象`);
    if (!idOk(p.id)) errs.push(`${at}: id 格式错误`);
    else if (ids.has(p.id)) errs.push(`${at}: id 重复`);
    else ids.add(p.id);
    if (!titleOk(p.title)) errs.push(`${at}: 需要 title`);
    if (p.size !== undefined && !(PANEL_SIZES as readonly string[]).includes(String(p.size))) errs.push(`${at}: size 取值错误`);
    checkRefresh(p.refresh, at, errs);
    if (!Array.isArray(p.items) || p.items.length > MAX_ITEMS) return void errs.push(`${at}: items 必须是数组 (最多 24 个)`);
    p.items.forEach((it, j) => checkItem(it, `${at}.items[${j}]`, errs));
  });
  return errs;
}
