import type { ItemType } from "@hx-aioa/protocol";
import { renderLine } from "./chart";
import type { Ctx } from "./frame";
import { renderApproval, renderChat } from "./interact";
import { renderButton, renderList, renderReport, renderStatusGrid, renderTaskCard } from "./lists";
import { renderTodo } from "./todo";
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
  chat: renderChat,
  approval: renderApproval,
  todo: renderTodo,
};

export function renderItem(ctx: Ctx): HTMLElement {
  return RENDERERS[ctx.item.type](ctx);
}
