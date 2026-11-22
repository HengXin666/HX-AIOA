import type { Panel, Space } from "@hx-aioa/protocol";
import { CLS, SPACES_PATH, STORAGE_ORDER, STORAGE_SPACE, TXT_LOADING } from "../constants";
import { api, hasServer, json } from "../core/api";
import type { Actions } from "../core/backend";
import { button, clear, h, icon } from "../core/dom";
import { Scope } from "../core/scope";
import { TOPIC_SPACES, type Store } from "../core/store";
import { renderItem } from "./registry";

type Orders = Record<string, string[]>;
const METRIC_TYPES = new Set(["value", "sparkline", "line", "ring", "status_grid"]);

const loadOrders = (): Orders => JSON.parse(localStorage.getItem(STORAGE_ORDER) ?? "{}") as Orders;

function saveOrder(spaceId: string, ids: string[]): void {
  const all = loadOrders();
  all[spaceId] = ids;
  localStorage.setItem(STORAGE_ORDER, JSON.stringify(all));
  // 显示状态与布局分开存, Agent 重新下发不会覆盖用户排序
  if (hasServer()) api(`${SPACES_PATH}/${encodeURIComponent(spaceId)}/state`, json("PUT", { order: ids })).catch(() => undefined);
}

export function orderedPanels(space: Space): Panel[] {
  const order = loadOrders()[space.id] ?? [];
  const rank = (p: Panel) => {
    const i = order.indexOf(p.id);
    return i < 0 ? order.length + space.panels.indexOf(p) : i;
  };
  return [...space.panels].sort((a, b) => rank(a) - rank(b));
}

export function metricSubjects(space: Space): string[] {
  const set = new Set<string>();
  for (const p of space.panels) for (const it of p.items) if (METRIC_TYPES.has(it.type)) it.bind?.forEach((b) => set.add(b.subject));
  return [...set];
}

export type PanelEnv = { store: Store; actions: Actions; scope: Scope };

export function renderPanel(env: PanelEnv, space: Space, panel: Panel, tools?: HTMLElement): HTMLElement {
  const refresh = panel.refresh.mode === "push" ? "实时" : `每 ${Math.round(panel.refresh.everySec / 60)} 分钟`;
  const items = h("div", { class: "items" });
  for (const item of panel.items) items.append(renderItem({ ...env, space, panel, item }));
  return h(
    "section",
    { class: `card panel size-${panel.size ?? "m"}`, "data-panel": panel.id },
    h("div", { class: "panel-head" }, icon(panel.icon), h("strong", {}, panel.title), h("span", { class: CLS.meta }, refresh), tools ?? null),
    items,
  );
}

// 多工作台: 顶部切换, 编辑模式下可上下移动或拖拽面板排序
export function renderSpaces(root: HTMLElement, env: PanelEnv, filter: (s: Space) => boolean = () => true): void {
  let editing = false;
  let child = new Scope();
  env.scope.add(() => child.dispose());
  const draw = () => {
    child.dispose();
    child = new Scope();
    const penv: PanelEnv = { ...env, scope: child };
    clear(root);
    const spaces = env.store.spaces.filter(filter);
    if (!spaces.length) {
      root.append(h("div", { class: "w-ph" }, icon("layout-dashboard"), env.store.ready ? "还没有工作台, Agent 可通过接口下发" : TXT_LOADING));
      return;
    }
    const cur = spaces.find((s) => s.id === localStorage.getItem(STORAGE_SPACE)) ?? spaces[0]!;
    const tabs = h("div", { class: "tabs" });
    for (const s of spaces) {
      const pick = () => {
        localStorage.setItem(STORAGE_SPACE, s.id);
        draw();
      };
      tabs.append(h("button", { class: s.id === cur.id ? "tab on" : "tab", type: "button", onclick: pick }, icon(s.icon), s.title));
    }
    const edit = button(editing ? "完成" : "排序", () => {
      editing = !editing;
      draw();
    }, CLS.ghostSm, editing ? "check" : "settings");
    root.append(h("div", { class: "row between space-bar" }, tabs, edit));
    const list = h("div", { class: `panels${editing ? " editing" : ""}` });
    const panels = orderedPanels(cur);
    const ids = panels.map((p) => p.id);
    const move = (from: number, to: number) => {
      if (to < 0 || to >= ids.length) return;
      const [id] = ids.splice(from, 1);
      ids.splice(to, 0, id!);
      saveOrder(cur.id, ids);
      draw();
    };
    panels.forEach((p, i) => {
      const tools = editing
        ? h(
            "span",
            { class: "row tools" },
            h("button", { class: CLS.ghostSm, type: "button", "aria-label": "上移", onclick: () => move(i, i - 1) }, icon("chevron-up")),
            h("button", { class: CLS.ghostSm, type: "button", "aria-label": "下移", onclick: () => move(i, i + 1) }, icon("chevron-down")),
          )
        : undefined;
      const el = renderPanel(penv, cur, p, tools);
      if (editing) {
        el.draggable = true;
        el.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/plain", String(i)));
        el.addEventListener("dragover", (e) => e.preventDefault());
        el.addEventListener("drop", (e) => {
          e.preventDefault();
          move(Number(e.dataTransfer?.getData("text/plain")), i);
        });
      }
      list.append(el);
    });
    root.append(list);
    env.actions.watch(metricSubjects(cur));
  };
  env.scope.add(env.store.on(TOPIC_SPACES, draw));
  draw();
}
