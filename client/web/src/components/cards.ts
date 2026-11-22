import { CLS } from "../constants";
import type { Envelope, EventEnvelope, PromptOption, ReportEnvelope, TaskSnapshot } from "@hx-aioa/protocol";
import type { Actions } from "../core/backend";
import { agoText, button, h, icon } from "../core/dom";
import { markdown } from "../core/md";

export const TASK_STATE_TEXT: Record<TaskSnapshot["state"], string> = {
  running: "进行中",
  waiting: "等待确认",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const SEVERITY_ICON: Record<string, string> = {
  critical: "triangle-alert",
  warning: "triangle-alert",
  normal: "bell",
  info: "newspaper",
};

export const openTask = (id: string) => (location.hash = `#/agent/${encodeURIComponent(id)}`);
export const openReport = (id: string) => (location.hash = `#/read/${encodeURIComponent(id)}`);

function optionKind(o: PromptOption): "approve" | "reject" {
  return o.style === "primary" || o.style === "danger" ? "approve" : "reject";
}

export function promptBox(task: TaskSnapshot, actions: Actions): HTMLElement | null {
  const p = task.prompt;
  if (!p || task.state !== "waiting") return null;
  if (p.expired) return h("div", { class: "prompt muted" }, "确认已超时");
  const opts: PromptOption[] = p.options.length
    ? p.options
    : [
        { id: "approve", label: "同意", style: "primary" },
        { id: "reject", label: "拒绝" },
      ];
  const row = h("div", { class: "btn-row" });
  for (const o of opts) {
    const cls = o.style === "danger" ? "btn danger" : o.style === "primary" ? CLS.primary : "btn";
    const danger = p.danger === true || o.style === "danger";
    row.append(button(o.label, () => actions.act({ taskId: task.id, kind: optionKind(o), option: o.id }, danger), cls));
  }
  const box = h("div", { class: "prompt" }, h("div", { class: "q" }, p.question), row);
  if (p.allowText) box.append(replyForm(task.id, actions));
  return box;
}

export function replyForm(taskId: string, actions: Actions, kind: "reply" | "ask" = "reply"): HTMLElement {
  const input = h("input", { class: "input", placeholder: kind === "ask" ? "追问 Agent..." : "回复..." });
  const form = h("form", { class: "reply" }, input, h("button", { class: "btn icon-btn", type: "submit", "aria-label": "发送" }, icon("send")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text && actions.act({ taskId, kind, text })) input.value = "";
  });
  return form;
}

export function taskCard(task: TaskSnapshot, actions: Actions, compact = false): HTMLElement {
  const pct = Math.round((task.progress ?? 0) * 100);
  return h(
    "article",
    { class: `card task st-${task.state}`, "data-task": task.id },
    h(
      "div",
      { class: "row between", onclick: () => openTask(task.id) },
      h("div", { class: "row" }, icon("bot"), h("strong", {}, task.title)),
      h("span", { class: `chip st-${task.state}` }, TASK_STATE_TEXT[task.state]),
    ),
    h("div", { class: CLS.meta }, `${task.agent} · ${task.step ?? task.summary ?? ""} · ${agoText(task.updated)}`),
    task.state === "running" ? h("div", { class: "bar" }, h("i", { style: `width:${pct}%` })) : null,
    compact ? null : promptBox(task, actions),
    task.error ? h("div", { class: "meta danger-text" }, task.error) : null,
  );
}

export type RowOps = { onSkip?: () => void; onSave?: () => void; saved?: boolean; onDone?: () => void };

export function eventRow(ev: Envelope, ops: RowOps = {}): HTMLElement {
  const isReport = ev.kind === "report";
  const d = (ev as EventEnvelope | ReportEnvelope).data;
  const sev = ev.kind === "event" ? ev.data.severity : "info";
  const ops$ = h("div", { class: "row-ops" });
  if (ops.onSave) ops$.append(button(ops.saved ? "已收藏" : "收藏", ops.onSave, CLS.ghostSm, "bookmark"));
  if (ops.onSkip) ops$.append(button("跳过", ops.onSkip, CLS.ghostSm, "skip-forward"));
  if (ops.onDone) ops$.append(button("完成", ops.onDone, CLS.ghostSm, "check"));
  const open = () => (isReport ? openReport(ev.id) : ev.kind === "event" && ev.data.url ? window.open(ev.data.url, "_blank") : undefined);
  return h(
    "div",
    { class: `ev sev-${sev}`, "data-ev": ev.id },
    h("span", { class: "ev-ic" }, icon(isReport ? "file-text" : SEVERITY_ICON[sev] ?? ev.source.icon)),
    h(
      "div",
      { class: "ev-main", onclick: open },
      h("div", { class: "ev-title" }, "title" in d ? d.title : ""),
      d.summary ? h("div", { class: "ev-sum" }, d.summary) : null,
      h("div", { class: CLS.meta }, `${ev.source.name} · ${agoText(ev.ts)}`),
    ),
    ops$.childElementCount ? ops$ : null,
  );
}

export function reportView(ev: ReportEnvelope, full = true): HTMLElement {
  const body = h("div", { class: "md" });
  body.innerHTML = markdown(full ? ev.data.markdown ?? ev.data.summary ?? "" : ev.data.summary ?? "");
  return h(
    "article",
    { class: "report" },
    h("h2", {}, ev.data.title),
    h("div", { class: CLS.meta }, `${ev.source.name} · ${ev.data.period ?? agoText(ev.ts)}`),
    body,
    ev.data.refs?.length ? h("div", { class: CLS.meta }, `引用原始事件 ${ev.data.refs.length} 条, 可在动态中追溯`) : null,
  );
}
