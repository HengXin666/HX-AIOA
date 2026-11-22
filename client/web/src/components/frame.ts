import type { Bind, Item, Panel, Space } from "@hx-aioa/protocol";
import { STALE_CHECK_MS, STALE_FACTOR, TXT_EMPTY, TXT_ERROR, TXT_LOADING, TXT_STALE } from "../constants";
import type { Actions } from "../core/backend";
import { clear, h, icon, timeText } from "../core/dom";
import type { Scope } from "../core/scope";
import { TOPIC_LINK, type Store } from "../core/store";

export type Ctx = { store: Store; actions: Actions; scope: Scope; space: Space; panel: Panel; item: Item };

export type WidgetSpec = {
  binds: Bind[];
  hasData: () => boolean;
  render: (body: HTMLElement) => void;
  bare?: boolean;
};

export type WidgetState = "loading" | "empty" | "error" | "stale" | "ok";

export function staleMs(ctx: Ctx): number {
  const r = ctx.panel.refresh;
  if (r.mode === "interval") return r.everySec * 1000 * STALE_FACTOR;
  const expect = Number(ctx.item.props?.expectSec ?? 0);
  return expect > 0 ? expect * 1000 * STALE_FACTOR : 0;
}

function placeholder(state: WidgetState, text: string): HTMLElement {
  const ic = state === "error" ? "triangle-alert" : state === "empty" ? "database" : "refresh-cw";
  return h("div", { class: `w-ph w-ph-${state}` }, icon(ic), h("span", {}, text));
}

// 每个组件共用的外壳: 负责 空 / 加载 / 错误 / 过期 四种状态与订阅
export function mountWidget(ctx: Ctx, spec: WidgetSpec): HTMLElement {
  const { store, item, scope } = ctx;
  const body = h("div", { class: "w-body" });
  const badge = h("span", { class: "w-badge" });
  const head = item.title
    ? h("div", { class: "w-head" }, item.icon ? icon(item.icon) : null, h("span", { class: "w-title" }, item.title), badge)
    : null;
  // 每个图表都写明它回答的问题, 放在标题下
  const question = item.question ? h("div", { class: "w-q" }, item.question) : null;
  const root = h("section", { class: `widget w-${item.type}`, "data-item": item.id }, head, question, body);
  if (!head) root.append(badge);
  const limit = staleMs(ctx);
  let frame = 0;
  let last: WidgetState | null = null;

  const stateOf = (): WidgetState => {
    const err = store.linkError ?? spec.binds.map((b) => store.errorOf(b)).find(Boolean);
    if (err) return "error";
    if (!spec.hasData()) return store.ready ? "empty" : "loading";
    return limit && Date.now() - lastTs() > limit ? "stale" : "ok";
  };
  const lastTs = () => Math.max(0, ...spec.binds.map((b) => store.lastUpdate(b) ?? 0));

  const paint = () => {
    frame = 0;
    const st = stateOf();
    root.dataset.state = st;
    badge.textContent = st === "stale" ? `${TXT_STALE} · 最后更新 ${timeText(lastTs())}` : "";
    if (st === "ok" || st === "stale") {
      clear(body);
      spec.render(body);
      if (last === "ok" || last === "stale") root.classList.add("w-tick");
      window.setTimeout(() => root.classList.remove("w-tick"), 400);
    } else {
      clear(body);
      const err = store.linkError ?? spec.binds.map((b) => store.errorOf(b)).find(Boolean);
      const text = st === "error" ? `${TXT_ERROR}: ${err}` : st === "empty" ? TXT_EMPTY : TXT_LOADING;
      body.append(placeholder(st, text));
    }
    last = st;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };

  spec.binds.forEach((b) => scope.add(store.onBind(b, schedule)));
  scope.add(store.on(TOPIC_LINK, schedule));
  if (limit) scope.interval(() => (stateOf() !== last ? schedule() : undefined), STALE_CHECK_MS);
  paint();
  return root;
}

export function lastValue(store: Store, b: Bind): number | undefined {
  return store.seriesOf(b).at(-1)?.v;
}

export function fmtNum(v: number, digits = 1): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}

export function levelOf(v: number, warn?: number, crit?: number): "ok" | "warn" | "crit" {
  if (crit !== undefined && v >= crit) return "crit";
  if (warn !== undefined && v >= warn) return "warn";
  return "ok";
}
