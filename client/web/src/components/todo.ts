import { PATH_PDATA_COLL, PATH_PDATA_ITEM, TODO_COLL, TODO_PLUGIN, todoOf, type PDataItem, type PDataList, type TodoBody, type TodoItem } from "@hx-aioa/protocol";
import { CLS } from "../constants";
import { api, hasServer, json } from "../core/api";
import { h } from "../core/dom";
import { pdataTopic } from "../core/store";
import type { Ctx } from "./frame";

const DONE = ["done", "dropped"];
const PRIO_LABEL: Record<number, string> = { 1: "急", 2: "", 3: "以后" };
const ERR_CLS = "w-ph w-ph-error";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// 截止倒计时 (#105): "还剩 2 天" / "还剩 3 小时" / "逾期 1 天"
export function countdown(due: number, now = Date.now()): string {
  const left = due - now;
  const abs = Math.abs(left);
  const span = abs >= DAY_MS ? `${Math.floor(abs / DAY_MS)} 天` : abs >= HOUR_MS ? `${Math.floor(abs / HOUR_MS)} 小时` : `${Math.max(1, Math.floor(abs / 60_000))} 分钟`;
  return left >= 0 ? `还剩 ${span}` : `逾期 ${span}`;
}
const COLL = PATH_PDATA_COLL.replace("{plugin}", TODO_PLUGIN).replace("{coll}", TODO_COLL);
const TOPIC = pdataTopic(TODO_PLUGIN, TODO_COLL);

// 本账号的全部待办行 (各群共用一个集合), 页面里的待办组件共用, 按 rev 增量拉
const rows = new Map<string, PDataItem>();
let rev = 0;
let pulling: Promise<void> | null = null;

async function pullOnce(): Promise<void> {
  for (let more = true; more; ) {
    const r = await api<PDataList>(`${COLL}?since=${rev}`);
    // 服务端回收过墓碑或清除过数据: 这一页从头给, 本地副本先清空
    if (r.reset) rows.clear();
    for (const it of r.items) {
      if (it.deleted) rows.delete(it.id);
      else rows.set(it.id, it);
    }
    rev = r.rev;
    more = r.more;
  }
}
const pull = () => (pulling ??= pullOnce().finally(() => (pulling = null)));

// 待办组件: bind.subject 是群 channel; 数据在插件数据 pdata, 收到 pdata_sync 增量刷新, 勾选带 ver 写回, 冲突就重读
export function renderTodo(ctx: Ctx): HTMLElement {
  const root = h("section", { class: "widget w-todo", "data-item": ctx.item.id });
  const channel = ctx.item.bind?.[0]?.subject;
  if (!channel) {
    root.append(h("div", { class: ERR_CLS }, "待办组件需要 bind.subject 指向群"));
    return root;
  }
  const fail = (e: Error) => root.replaceChildren(h("div", { class: ERR_CLS }, e.message));
  const draw = () => {
    root.replaceChildren();
    const todos = [...rows.values()].flatMap((it) => todoOf(it, channel) ?? []);
    // 星标在前, 再按截止近的, 再按优先级
    const open = todos.filter((t) => !DONE.includes(t.state)).sort((a, b) => Number(!!b.star) - Number(!!a.star) || (a.due ?? Infinity) - (b.due ?? Infinity) || a.prio - b.prio || b.updated - a.updated);
    if (!open.length) root.append(h("div", { class: "w-ph" }, "没有待办"));
    for (const t of open.slice(0, Number(ctx.item.props?.limit ?? 20))) {
      const box = h("input", { type: "checkbox" }) as HTMLInputElement;
      box.onchange = () => void finish(t);
      const meta = [t.star ? "★" : "", t.area ?? "", t.due ? countdown(t.due) : "", PRIO_LABEL[t.prio] ?? ""].filter(Boolean).join(" · ");
      root.append(h("label", { class: "todo-row" }, box, h("span", {}, t.title), h("span", { class: CLS.meta }, meta)));
    }
    const done = todos.length - open.length;
    if (done) root.append(h("div", { class: CLS.meta }, `已完成 ${done} 条`));
  };
  const load = () => pull().then(draw).catch(fail);
  const finish = async (t: TodoItem) => {
    const row = [...rows.values()].find((it) => todoOf(it, channel)?.id === t.id);
    if (!row) return load();
    const body: TodoBody = { ...(row.body as TodoBody), state: "done" };
    const path = PATH_PDATA_ITEM.replace("{plugin}", TODO_PLUGIN).replace("{coll}", TODO_COLL).replace("{id}", encodeURIComponent(row.id));
    // 版本不对 (Agent 刚改过) 或别的失败: 以服务端为准重读
    await api(path, json("PUT", { ver: row.ver, body })).catch(() => undefined);
    return load();
  };
  ctx.scope.add(ctx.store.on(TOPIC, () => ((ctx.store.pdataRev.get(TOPIC) ?? 0) > rev ? void load() : undefined)));
  if (hasServer()) void load();
  else draw();
  return root;
}
