import { PATH_TODOS, type TodoItem } from "@hx-aioa/protocol";
import { CLS } from "../constants";
import { api, hasServer, json } from "../core/api";
import { h } from "../core/dom";
import type { Ctx } from "./frame";

const DONE = ["done", "dropped"];
const PRIO_LABEL: Record<number, string> = { 1: "急", 2: "", 3: "以后" };

// 待办组件: bind.subject 是群 channel; 打开时拉一次, 勾选直接写回服务端
export function renderTodo(ctx: Ctx): HTMLElement {
  const root = h("section", { class: "widget w-todo", "data-item": ctx.item.id });
  const channel = ctx.item.bind?.[0]?.subject;
  if (!channel) {
    root.append(h("div", { class: "w-ph w-ph-error" }, "待办组件需要 bind.subject 指向群"));
    return root;
  }
  const path = PATH_TODOS.replace("{channel}", encodeURIComponent(channel));
  const draw = (todos: TodoItem[]) => {
    root.replaceChildren();
    const open = todos.filter((t) => !DONE.includes(t.state)).sort((a, b) => a.prio - b.prio || b.updated - a.updated);
    if (!open.length) root.append(h("div", { class: "w-ph" }, "没有待办"));
    for (const t of open.slice(0, Number(ctx.item.props?.limit ?? 20))) {
      const box = h("input", { type: "checkbox" }) as HTMLInputElement;
      box.onchange = () => void api(path, json("POST", { todos: [{ id: t.id, state: "done" }] })).then(load);
      root.append(h("label", { class: "todo-row" }, box, h("span", {}, t.title), h("span", { class: CLS.meta }, PRIO_LABEL[t.prio] ?? "")));
    }
    const done = todos.length - open.length;
    if (done) root.append(h("div", { class: CLS.meta }, `已完成 ${done} 条`));
  };
  const load = () => api<{ todos: TodoItem[] }>(path).then((r) => draw(r.todos)).catch((e: Error) => root.replaceChildren(h("div", { class: "w-ph w-ph-error" }, e.message)));
  if (hasServer()) void load();
  else draw([]);
  return root;
}
