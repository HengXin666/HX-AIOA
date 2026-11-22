import { iconSvg } from "./icons";

type Attrs = Record<string, string | number | boolean | undefined | null | ((e: Event) => void)>;
type Child = Node | string | null | undefined | false;

// 极小的 DOM 构造器: on 开头的属性作为事件, 其余作为 attribute
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
}

export function icon(name: string | undefined, cls = "ic"): HTMLElement {
  const span = h("span", { class: cls, "aria-hidden": "true" });
  span.innerHTML = iconSvg(name);
  return span;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

export function button(label: string, onclick: () => void, cls = "btn", ic?: string): HTMLButtonElement {
  return h("button", { class: cls, type: "button", onclick }, ic ? icon(ic) : null, label);
}

const fmtTime = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function timeText(ts: number): string {
  return fmtTime.format(ts);
}

export function agoText(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86_400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86_400)} 天前`;
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
