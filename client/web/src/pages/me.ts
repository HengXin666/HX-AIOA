import type { SourceInfo } from "@hx-aioa/protocol";
import { CLS, SERVER_URL, STATUS_ONLINE } from "../constants";
import { orderedPanels } from "../components/space";
import { h, icon } from "../core/dom";
import { deleteSource, listSources } from "../core/sources";
import { TOPIC_LINK, TOPIC_SPACES } from "../core/store";
import { pageHead, section, type Env } from "./page";
import { sourcePath } from "./sources";

type Src = { name: string; icon?: string; type?: string; note: string; id?: string };

function link(href: string, ic: string, title: string, sub: string): HTMLElement {
  return h("a", { class: "ev menu", href }, h("span", { class: "ev-ic" }, icon(ic)), h("div", { class: "ev-main" }, h("div", { class: "ev-title" }, title), h("div", { class: CLS.meta }, sub)), icon("chevron-right"));
}

function srcRow(s: Src): HTMLElement {
  return h("div", { class: "ev" }, h("span", { class: "ev-ic" }, icon(s.icon ?? "plug")), h("div", { class: "ev-main" }, h("div", { class: "ev-title" }, s.name), h("div", { class: CLS.meta }, s.note)));
}

function registeredRow(s: SourceInfo, onDelete: () => void): HTMLElement {
  return h(
    "div",
    { class: "ev" },
    h("span", { class: "ev-ic" }, icon(s.icon ?? "plug")),
    h("a", { class: "ev-main", href: sourcePath(s.id) }, h("div", { class: "ev-title" }, s.name), h("div", { class: CLS.meta }, `${s.type}${s.subject ? ` · ${s.subject}` : ""}`)),
    h("button", { class: CLS.ghostSm, type: "button", "aria-label": "删除", onclick: onDelete }, icon("trash")),
  );
}

// 本地能看到的来源: 事件里的 source 加上有指标的主体
function localSources(env: Env): Src[] {
  const out = new Map<string, Src>();
  for (const e of env.store.events.values()) out.set(e.source.id, { name: e.source.name, icon: e.source.icon, note: `事件来源 · ${e.source.type ?? "推送"}` });
  for (const s of env.store.subjects()) out.set(`m:${s}`, { name: s, icon: "server", note: "指标 · 探针" });
  return [...out.values()];
}

export function mePage(root: HTMLElement, env: Env): void {
  const conn = h("div", { class: CLS.cardList });
  const sources = h("div", { class: CLS.cardList });
  const spaces = h("div", { class: CLS.cardList });
  const drawConn = () => {
    const s = env.store;
    const mode = env.actions.mode === "mock" ? "模拟数据 (?mock=1)" : env.actions.mode === "live" ? "实时连接" : "未配置";
    conn.replaceChildren(
      srcRow({ name: "模式", icon: "plug", note: mode }),
      srcRow({ name: "服务端", icon: "server", note: SERVER_URL || "未配置 VITE_AIOA_SERVER" }),
      srcRow({ name: "状态", icon: s.online ? "wifi" : "wifi-off", note: s.linkError ?? (s.online ? STATUS_ONLINE : "离线") }),
    );
  };
  const drawSpaces = () => {
    spaces.replaceChildren(
      ...env.store.spaces.map((sp) =>
        h(
          "div",
          { class: "ev" },
          h("span", { class: "ev-ic" }, icon(sp.icon)),
          h("div", { class: "ev-main" }, h("div", { class: "ev-title" }, sp.title), h("div", { class: CLS.meta }, `${sp.origin?.startsWith("agent") ? "Agent 生成" : "手动"} · ${orderedPanels(sp).map((p) => p.title).join(", ")}`)),
        ),
      ),
    );
  };
  const add = link("#/me/sources/new", "plus", "添加数据源", "GitHub, 通用 Webhook, Uptime Kuma 等, 按步骤接入");
  const remove = (s: SourceInfo) => {
    if (!window.confirm(`删除 "${s.name}"? 绑定的接入 key 会一起作废。`)) return;
    deleteSource(env.actions.mode, s.id).then(loadSources).catch(() => undefined);
  };
  const drawSources = (list: Src[], registered: SourceInfo[] = []) =>
    sources.replaceChildren(add, ...registered.map((s) => registeredRow(s, () => remove(s))), ...list.map(srcRow), ...(list.length || registered.length ? [] : [h("div", { class: "meta pad" }, "还没有数据源")]));
  const loadSources = () => {
    if (env.actions.mode === "none") return drawSources(localSources(env));
    listSources(env.actions.mode)
      .then((r) => drawSources(env.actions.mode === "mock" ? localSources(env) : [], r))
      .catch(() => drawSources(localSources(env)));
  };
  loadSources();

  root.append(
    pageHead("我的", "数据源, 规则, 组件, 布局与设置"),
    section("设置", "settings", h("div", { class: CLS.cardList }, link("#/me/look", "palette", "外观", "主题, 主题色, 背景, 毛玻璃, 圆角, 字号, 密度"), link("#/me/rules", "bell", "规则", "决定什么响铃, 什么静默, 什么进摘要"))),
    section("数据源", "plug", sources),
    section("工作台与组件", "layout-dashboard", spaces),
    section("连接", "wifi", conn),
    section("关于", "circle-help", h("div", { class: "card pad meta" }, "HX-AIOA Web · 协议 v1")),
  );
  env.scope.add(env.store.on(TOPIC_LINK, drawConn));
  env.scope.add(env.store.on(TOPIC_SPACES, drawSpaces));
  drawConn();
  drawSpaces();
}
