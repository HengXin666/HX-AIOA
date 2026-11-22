import type { Envelope } from "./event";
import { BIND_REQUIRED, PANEL_SIZES, isPanelSize, type Bind, type Panel, type PanelSize, type Space, type SpaceState } from "./space";

// 面板宽度按 4 列网格计算; 窄屏时客户端把超出的列数收拢为整行
export const GRID_COLUMNS = 4;
export const DEFAULT_PANEL_SIZE: PanelSize = "m";
export const PANEL_SPAN: Record<PanelSize, number> = { s: 1, m: 2, l: 3, full: GRID_COLUMNS };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function panelSizeOf(space: Space, panel: Panel): PanelSize {
  return space.state?.sizes?.[panel.id] ?? panel.size ?? DEFAULT_PANEL_SIZE;
}

// 放大或缩小一档, 到头不变
export function stepSize(size: PanelSize, delta: 1 | -1): PanelSize {
  const i = PANEL_SIZES.indexOf(size) + delta;
  return PANEL_SIZES[Math.max(0, Math.min(PANEL_SIZES.length - 1, i))]!;
}

// 用户排序优先, 未排过的面板按布局原顺序接在后面; 隐藏的面板不返回
export function orderPanels(space: Space, order: string[] = space.state?.order ?? []): Panel[] {
  const hidden = new Set(space.state?.hiddenPanels ?? []);
  const rank = (p: Panel) => {
    const i = order.indexOf(p.id);
    return i < 0 ? order.length + space.panels.indexOf(p) : i;
  };
  return space.panels.filter((p) => !hidden.has(p.id)).sort((a, b) => rank(a) - rank(b));
}

// 校验并合并 PUT /spaces/{id}/state 的请求体; 面板 id 必须存在于当前布局, 拼错会直接报错
export function parseSpaceState(raw: unknown, space: Space, cur: SpaceState = {}): SpaceState | string {
  if (!isRecord(raw)) return "state 必须是对象";
  const known = new Set(space.panels.map((p) => p.id));
  const unknown = (ids: string[]) => ids.filter((id) => !known.has(id));
  const errs: string[] = [];
  const next: SpaceState = { ...cur };
  if (raw.hidden !== undefined) {
    if (typeof raw.hidden !== "boolean") errs.push("hidden 必须是布尔值");
    else next.hidden = raw.hidden;
  }
  for (const key of ["hiddenPanels", "order"] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (!isStrings(v)) errs.push(`${key} 必须是字符串数组`);
    else if (unknown(v).length) errs.push(`${key} 含有不存在的面板: ${unknown(v).join(", ")}`);
    else if (new Set(v).size !== v.length) errs.push(`${key} 有重复的面板`);
    else next[key] = v;
  }
  if (raw.sizes !== undefined) {
    if (!isRecord(raw.sizes)) errs.push("sizes 必须是 面板 id → 尺寸 的对象");
    else {
      const bad = Object.entries(raw.sizes).filter(([id, s]) => !known.has(id) || !isPanelSize(s));
      if (bad.length) errs.push(`sizes 取值错误: ${bad.map(([id]) => id).join(", ")} (尺寸只能是 ${PANEL_SIZES.join("/")})`);
      else next.sizes = { ...cur.sizes, ...(raw.sizes as Record<string, PanelSize>) };
    }
  }
  return errs.length ? errs.join("; ") : next;
}

// 服务端按绑定解析出的当前值: 客户端打开工作台时先用它填充, 之后由实时推送接管
export type BindValue = { subject: string; field: string; value: number; ts: number; unit?: string };
export type SpaceData = { id: string; generatedAt: number; values: BindValue[]; events: Envelope[] };

export function spaceBinds(space: Space): { metrics: Bind[]; feeds: Bind[] } {
  const metrics: Bind[] = [];
  const feeds: Bind[] = [];
  for (const p of space.panels) {
    for (const it of p.items) {
      const list = BIND_REQUIRED.includes(it.type) ? metrics : it.type === "list" || it.type === "report" ? feeds : null;
      it.bind?.forEach((b) => list?.push(b));
    }
  }
  return { metrics, feeds };
}
