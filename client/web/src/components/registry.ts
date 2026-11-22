import type { ItemType } from "@hx-aioa/protocol";
import { renderLine } from "./chart";
import type { Ctx } from "./frame";
import { renderButton, renderList, renderReport, renderStatusGrid, renderTaskCard } from "./lists";
import { renderRing, renderSparkline, renderValue } from "./metric";

const RENDERERS: Record<ItemType, (ctx: Ctx) => HTMLElement> = {
  value: renderValue,
  sparkline: renderSparkline,
  line: renderLine,
  ring: renderRing,
  status_grid: renderStatusGrid,
  task_card: renderTaskCard,
  list: renderList,
  report: renderReport,
  button: renderButton,
};

export function renderItem(ctx: Ctx): HTMLElement {
  return RENDERERS[ctx.item.type](ctx);
}
