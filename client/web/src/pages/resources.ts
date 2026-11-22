import type { ReportEnvelope } from "@hx-aioa/protocol";
import { reportView } from "../components/cards";
import { renderSpaces } from "../components/space";
import { h } from "../core/dom";
import { TOPIC_EVENTS } from "../core/store";
import { emptyNote, pageHead, type Env } from "./page";

export function resourcesPage(root: HTMLElement, env: Env): void {
  const host = h("div", {});
  root.append(pageHead("资源", "设备与服务, 按工作台组织"), host);
  renderSpaces(host, env);
}

export function readerPage(root: HTMLElement, env: Env, id?: string): void {
  const draw = () => {
    const ev = env.store.events.get(decodeURIComponent(id ?? ""));
    root.replaceChildren(pageHead("阅读", undefined, "#/overview"));
    root.append(ev?.kind === "report" ? h("div", { class: "card" }, reportView(ev as ReportEnvelope)) : emptyNote("报告不存在或尚未加载", "file-text"));
  };
  env.scope.add(env.store.on(TOPIC_EVENTS, draw));
  draw();
}
