import { MAX_ID_LENGTH } from "./constants";

// 首页一级页面 (#139): 顺序与内置页面的置顶存账号设置 homeTabs, 跟账号走多端同步; 插件空间的置顶仍在各空间 state.pinned
// 自选图标 (#142): 内置页面的在 homeTabs.icons, 插件空间的在各空间 state.icon
export const SETTING_HOME_TABS = "homeTabs";
export const MAX_HOME_TABS = 64;
export type HomeTabs = { order: string[]; pins: Record<string, boolean>; icons?: Record<string, string> };

// 图标引用: 组件库图标名 (如 server, code-xml), 或上传的图片: img:<头像 id> 原色, svg:<头像 id> 单色 (SVG 在客户端光栅化后上传, 跟主题着色)
// 头像 id 是 PUT /avatars 返回的内容哈希 (十六进制)
export const ICON_IMG_PREFIX = "img:";
export const ICON_MONO_PREFIX = "svg:";
const ICON_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ICON_UPLOAD = /^(img|svg):[0-9a-f]{8,64}$/;
export const isIconRef = (v: unknown): v is string => typeof v === "string" && (ICON_NAME.test(v) || ICON_UPLOAD.test(v));

const idOk = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 校验 PATCH settings 里的 homeTabs: 只认 order, pins, icons 三个键, 返回规整后的值或错误; icons 为空时不带。 */
export function parseHomeTabs(v: unknown): HomeTabs | string {
  if (!isObj(v)) return "必须是 { order, pins, icons } 对象";
  const o = v;
  const extra = Object.keys(o).filter((k) => k !== "order" && k !== "pins" && k !== "icons");
  if (extra.length) return `不认识的键: ${extra.join(", ")}`;
  const order = o.order ?? [];
  if (!Array.isArray(order) || !order.every(idOk)) return `order 必须是页面 id 数组 (每个 1 到 ${MAX_ID_LENGTH} 字)`;
  if (order.length > MAX_HOME_TABS) return `order 最多 ${MAX_HOME_TABS} 个`;
  if (new Set(order).size !== order.length) return "order 有重复的页面";
  const pins = o.pins ?? {};
  if (!isObj(pins)) return "pins 必须是 页面 id → 布尔值 的对象";
  const entries = Object.entries(pins);
  if (entries.length > MAX_HOME_TABS) return `pins 最多 ${MAX_HOME_TABS} 个`;
  if (!entries.every(([k, b]) => idOk(k) && typeof b === "boolean")) return "pins 必须是 页面 id → 布尔值 的对象";
  const icons = o.icons ?? {};
  if (!isObj(icons)) return "icons 必须是 页面 id → 图标 的对象";
  const marks = Object.entries(icons);
  if (marks.length > MAX_HOME_TABS) return `icons 最多 ${MAX_HOME_TABS} 个`;
  if (!marks.every(([k, i]) => idOk(k) && isIconRef(i))) return "icons 的值必须是图标名, 或 img: / svg: 加上传得到的 id";
  const out: HomeTabs = { order, pins: Object.fromEntries(entries) as Record<string, boolean> };
  if (marks.length) out.icons = Object.fromEntries(marks) as Record<string, string>;
  return out;
}
