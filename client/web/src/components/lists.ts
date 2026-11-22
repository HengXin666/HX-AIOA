import type { Bind, ReportEnvelope } from "@hx-aioa/protocol";
import { ANY, FIELD_EVENTS, FIELD_REPORT, FIELD_TASK, CLS } from "../constants";
import { button, h } from "../core/dom";
import { eventRow, openReport, reportView, taskCard } from "./cards";
import { fmtNum, lastValue, levelOf, mountWidget, type Ctx } from "./frame";
import { thresholdFor, unitFor } from "./metric";

const bindsOr = (ctx: Ctx, field: string): Bind[] => ctx.item.bind?.length ? ctx.item.bind : [{ subject: ANY, field }];
const limitOf = (ctx: Ctx, d: number) => Number(ctx.item.props?.limit ?? d);

export function renderStatusGrid(ctx: Ctx): HTMLElement {
  const binds = ctx.item.bind ?? [];
  const labels = Array.isArray(ctx.item.props?.labels) ? (ctx.item.props.labels as string[]) : [];
  return mountWidget(ctx, {
    binds,
    hasData: () => binds.some((b) => lastValue(ctx.store, b) !== undefined),
    render: (body) => {
      const grid = h("div", { class: "grid-cells" });
      binds.forEach((b, i) => {
        const v = lastValue(ctx.store, b);
        const th = thresholdFor(ctx, b);
        // 无阈值时按在线语义: 1 正常, 0 离线
        const lv = v === undefined ? "none" : th.warn !== undefined || th.crit !== undefined ? levelOf(v, th.warn, th.crit) : v > 0 ? "ok" : "crit";
        const text = v === undefined ? "--" : th.warn === undefined && th.crit === undefined ? (v > 0 ? "在线" : "离线") : `${fmtNum(v)}${unitFor(ctx, b)}`;
        grid.append(h("div", { class: `cell lv-${lv}` }, h("i", { class: "dot" }), h("span", { class: "cell-name" }, labels[i] ?? b.subject), h("span", { class: "cell-v" }, text)));
      });
      body.append(grid);
    },
  });
}

export function renderTaskCard(ctx: Ctx): HTMLElement {
  const binds = bindsOr(ctx, FIELD_TASK);
  const pick = () => {
    const ids = binds.map((b) => b.subject);
    const all = [...ctx.store.tasks.values()].filter((t) => ids.includes(ANY) || ids.includes(t.id));
    return all.sort((a, b) => Number(b.state === "waiting") - Number(a.state === "waiting") || b.updated - a.updated).slice(0, limitOf(ctx, 3));
  };
  return mountWidget(ctx, {
    binds,
    hasData: () => pick().length > 0,
    render: (body) => pick().forEach((t) => body.append(taskCard(t, ctx.actions))),
  });
}

export function renderList(ctx: Ctx): HTMLElement {
  const binds = bindsOr(ctx, FIELD_EVENTS);
  const pick = () => binds.flatMap((b) => ctx.store.eventsFor(b.subject)).sort((a, b) => b.ts - a.ts).slice(0, limitOf(ctx, 5));
  return mountWidget(ctx, {
    binds,
    hasData: () => pick().length > 0,
    render: (body) => pick().forEach((ev) => body.append(eventRow(ev))),
  });
}

export function renderReport(ctx: Ctx): HTMLElement {
  const binds = bindsOr(ctx, FIELD_REPORT);
  const pick = () =>
    binds
      .flatMap((b) => ctx.store.eventsFor(b.subject))
      .find((e): e is ReportEnvelope => e.kind === "report");
  return mountWidget(ctx, {
    binds,
    hasData: () => pick() !== undefined,
    render: (body) => {
      const ev = pick()!;
      body.append(reportView(ev, false), button("阅读全文", () => openReport(ev.id), CLS.ghostSm, "chevron-right"));
    },
  });
}

export function renderButton(ctx: Ctx): HTMLElement {
  const a = ctx.item.action;
  const p = ctx.item.props ?? {};
  const label = typeof p.label === "string" ? p.label : ctx.item.title ?? a?.command ?? "执行";
  const root = h("section", { class: "widget w-button", "data-item": ctx.item.id });
  if (!a) {
    root.append(h("div", { class: "w-ph w-ph-error" }, "按钮缺少 action"));
    return root;
  }
  const btn = button(label, () => {
    const ok = ctx.actions.button(ctx.space.id, ctx.item.id, a);
    status.textContent = ok ? `已发送给 ${a.agent}` : "未连接, 发送失败";
  }, a.danger ? "btn danger block" : "btn primary block", ctx.item.icon);
  const status = h("div", { class: CLS.meta });
  root.append(btn, status);
  return root;
}
