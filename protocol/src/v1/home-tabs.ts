import { MAX_ID_LENGTH } from "./constants";

// 首页一级页面 (#139): 顺序与内置页面的置顶存账号设置 homeTabs, 跟账号走多端同步; 插件空间的置顶仍在各空间 state.pinned
export const SETTING_HOME_TABS = "homeTabs";
export const MAX_HOME_TABS = 64;
export type HomeTabs = { order: string[]; pins: Record<string, boolean> };

const idOk = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;

/** 校验 PATCH settings 里的 homeTabs: 只认 order 与 pins 两个键, 返回规整后的值或错误。 */
export function parseHomeTabs(v: unknown): HomeTabs | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "必须是 { order, pins } 对象";
  const o = v as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => k !== "order" && k !== "pins");
  if (extra.length) return `不认识的键: ${extra.join(", ")}`;
  const order = o.order ?? [];
  if (!Array.isArray(order) || !order.every(idOk)) return `order 必须是页面 id 数组 (每个 1 到 ${MAX_ID_LENGTH} 字)`;
  if (order.length > MAX_HOME_TABS) return `order 最多 ${MAX_HOME_TABS} 个`;
  if (new Set(order).size !== order.length) return "order 有重复的页面";
  const pins = o.pins ?? {};
  if (typeof pins !== "object" || pins === null || Array.isArray(pins)) return "pins 必须是 页面 id → 布尔值 的对象";
  const entries = Object.entries(pins as Record<string, unknown>);
  if (entries.length > MAX_HOME_TABS) return `pins 最多 ${MAX_HOME_TABS} 个`;
  if (!entries.every(([k, b]) => idOk(k) && typeof b === "boolean")) return "pins 必须是 页面 id → 布尔值 的对象";
  return { order, pins: Object.fromEntries(entries) as Record<string, boolean> };
}
