import { CLS } from "../constants";
import type { Actions } from "../core/backend";
import type { AppearanceStore } from "../theme/appearance";
import { h, icon } from "../core/dom";
import type { Scope } from "../core/scope";
import type { Store } from "../core/store";

export type Env = { store: Store; actions: Actions; scope: Scope; look: AppearanceStore };
export type Page = (root: HTMLElement, env: Env, arg?: string) => void;

export function section(title: string, ic: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", { class: "layer" }, h("h3", { class: "layer-title" }, icon(ic), title), ...children);
}

export function pageHead(title: string, sub?: string, back?: string): HTMLElement {
  return h(
    "header",
    { class: "page-head" },
    back ? h("a", { class: "back", href: back, "aria-label": "返回" }, icon("chevron-left")) : null,
    h("div", {}, h("h1", {}, title), sub ? h("div", { class: CLS.meta }, sub) : null),
  );
}

export function emptyNote(text: string, ic = "circle-check"): HTMLElement {
  return h("div", { class: "empty-note" }, icon(ic), h("span", {}, text));
}

// 内容签名不变时不重绘, 避免冲掉正在输入的回复
export function keyedRegion(render: (el: HTMLElement) => void, signature: () => string): { el: HTMLElement; update: () => void } {
  const el = h("div", { class: "region" });
  let sig = "";
  const update = () => {
    const next = signature();
    if (next === sig) return;
    sig = next;
    el.replaceChildren();
    render(el);
  };
  return { el, update };
}
