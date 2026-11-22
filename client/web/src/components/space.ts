import {
  BIND_REQUIRED,
  PANEL_SPAN,
  orderPanels,
  panelSizeOf,
  stepSize,
  type Panel,
  type PanelSize,
  type Space,
  type SpaceData,
  type SpaceState,
} from "@hx-aioa/protocol";
import { CLS, SPACES_PATH, STORAGE_LAYOUT, STORAGE_SPACE, TXT_LOADING } from "../constants";
import { api, hasServer, json } from "../core/api";
import type { Actions } from "../core/backend";
import { button, clear, h, icon } from "../core/dom";
import { Scope } from "../core/scope";
import { TOPIC_SPACES, type Store } from "../core/store";
import { renderItem } from "./registry";

type Layouts = Record<string, SpaceState>;
const SIZE_TEXT: Record<PanelSize, string> = { s: "小", m: "中", l: "大", full: "整行" };
const spacePath = (id: string, tail: string) => `${SPACES_PATH}/${encodeURIComponent(id)}/${tail}`;

const loadLayouts = (): Layouts => JSON.parse(localStorage.getItem(STORAGE_LAYOUT) ?? "{}") as Layouts;

// 有服务端时以服务端保存的状态为准, 本地演示模式存在 localStorage
export function withState(space: Space): Space {
  return hasServer() ? space : { ...space, state: { ...space.state, ...loadLayouts()[space.id] } };
}

function saveState(store: Store, space: Space, patch: SpaceState): void {
  const state = { ...withState(space).state, ...patch };
  store.upsertSpace({ ...space, state });
  if (!hasServer()) {
    localStorage.setItem(STORAGE_LAYOUT, JSON.stringify({ ...loadLayouts(), [space.id]: state }));
    return;
  }
  api(spacePath(space.id, "state"), json("PUT", patch)).catch(() => undefined);
}

export function orderedPanels(space: Space): Panel[] {
  return orderPanels(withState(space));
}

export function metricSubjects(space: Space): string[] {
  const set = new Set<string>();
  for (const p of space.panels) for (const it of p.items) if (BIND_REQUIRED.includes(it.type)) it.bind?.forEach((b) => set.add(b.subject));
  return [...set];
}

// 打开工作台时先取服务端解析好的当前值, 不用等探针推第一帧
function prime(store: Store, id: string): void {
  if (!hasServer()) return;
  api<SpaceData>(spacePath(id, "data"))
    .then((d) => {
      for (const v of d.values) store.ingestPoints(v.subject, [{ ts: v.ts, values: { [v.field]: v.value } }], v.unit ? { [v.field]: v.unit } : undefined);
      d.events.forEach((e) => store.ingest(e));
    })
    .catch(() => undefined);
}

export type PanelEnv = { store: Store; actions: Actions; scope: Scope };

export function renderPanel(env: PanelEnv, space: Space, panel: Panel, tools?: HTMLElement): HTMLElement {
  const refresh = panel.refresh.mode === "push" ? "实时" : `每 ${Math.round(panel.refresh.everySec / 60)} 分钟`;
  const size = panelSizeOf(space, panel);
  const items = h("div", { class: "items" });
  for (const item of panel.items) items.append(renderItem({ ...env, space, panel, item }));
  return h(
    "section",
    { class: `card panel size-${size}`, style: `--span:${PANEL_SPAN[size]}`, "data-panel": panel.id },
    h("div", { class: "panel-head" }, icon(panel.icon), h("strong", {}, panel.title), h("span", { class: CLS.meta }, refresh), tools ?? null),
    items,
  );
}

const tool = (label: string, ic: string, fn: () => void, off = false) =>
  h("button", { class: CLS.ghostSm, type: "button", "aria-label": label, title: label, disabled: off, onclick: fn }, icon(ic));

// 多工作台: 顶部切换; 编辑模式下可移动 (按钮或拖拽) 与调整面板宽度
export function renderSpaces(root: HTMLElement, env: PanelEnv, filter: (s: Space) => boolean = () => true): void {
  let editing = false;
  let primed = "";
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
    const raw = spaces.find((s) => s.id === localStorage.getItem(STORAGE_SPACE)) ?? spaces[0]!;
    const cur = withState(raw);
    if (primed !== cur.id) prime(env.store, (primed = cur.id));
    const tabs = h("div", { class: "tabs" });
    for (const s of spaces) {
      const pick = () => {
        localStorage.setItem(STORAGE_SPACE, s.id);
        draw();
      };
      tabs.append(h("button", { class: s.id === cur.id ? "tab on" : "tab", type: "button", onclick: pick }, icon(s.icon), s.title));
    }
    const edit = button(editing ? "完成" : "编辑布局", () => {
      editing = !editing;
      draw();
    }, CLS.ghostSm, editing ? "check" : "settings");
    root.append(h("div", { class: "row between space-bar" }, tabs, edit));
    const list = h("div", { class: `panels${editing ? " editing" : ""}` });
    const panels = orderPanels(cur);
    const ids = panels.map((p) => p.id);
    const move = (from: number, to: number) => {
      if (to < 0 || to >= ids.length) return;
      const [id] = ids.splice(from, 1);
      ids.splice(to, 0, id!);
      saveState(env.store, raw, { order: [...ids] });
    };
    const resize = (p: Panel, d: 1 | -1) => {
      const next = stepSize(panelSizeOf(cur, p), d);
      saveState(env.store, raw, { sizes: { ...cur.state?.sizes, [p.id]: next } });
    };
    panels.forEach((p, i) => {
      const size = panelSizeOf(cur, p);
      const tools = editing
        ? h(
            "span",
            { class: "row tools" },
            tool("上移", "chevron-up", () => move(i, i - 1), i === 0),
            tool("下移", "chevron-down", () => move(i, i + 1), i === panels.length - 1),
            tool("缩小", "minimize-2", () => resize(p, -1), size === "s"),
            h("span", { class: `${CLS.meta} size-tag` }, SIZE_TEXT[size]),
            tool("放大", "maximize-2", () => resize(p, 1), size === "full"),
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
