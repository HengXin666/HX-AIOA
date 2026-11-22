import { CLS, LAYER_TEXT } from "../constants";
import type { Envelope } from "@hx-aioa/protocol";
import { eventRow } from "../components/cards";
import { h } from "../core/dom";
import { TOPIC_EVENTS } from "../core/store";
import { messagesView } from "../legacy";
import { emptyNote, pageHead, type Env } from "./page";

type Filter = { id: string; label: string; test: (e: Envelope) => boolean };

const FILTERS: Filter[] = [
  { id: "all", label: "全部", test: () => true },
  { id: "need", label: LAYER_TEXT.need_me, test: (e) => e.priority === "need_me" },
  { id: "now", label: LAYER_TEXT.happening, test: (e) => e.priority === "happening" },
  { id: "worth", label: LAYER_TEXT.worth_reading, test: (e) => e.priority === "worth_reading" },
  { id: "msg", label: "消息", test: () => false },
];

// 动态页保留全部原始事件, 总览里的折叠和归纳都能在这里追溯
export function feedPage(root: HTMLElement, env: Env): void {
  let cur = FILTERS[0]!;
  const chips = h("div", { class: "tabs" });
  const body = h("div", {});
  const draw = () => {
    chips.replaceChildren(
      ...FILTERS.map((f) => h("button", { class: f === cur ? "tab on" : "tab", type: "button", onclick: () => ((cur = f), draw()) }, f.label)),
    );
    body.replaceChildren();
    if (cur.id === "msg") return void body.append(messagesView());
    const list = [...env.store.events.values()].filter(cur.test).sort((a, b) => b.ts - a.ts);
    if (!list.length) return void body.append(emptyNote("暂无动态", "rss"));
    body.append(h("div", { class: CLS.cardList }, ...list.map((e) => eventRow(e))));
  };
  root.append(pageHead("动态", "所有来源的原始事件, 按时间倒序"), chips, body);
  env.scope.add(env.store.on(TOPIC_EVENTS, () => cur.id !== "msg" && draw()));
  draw();
}
