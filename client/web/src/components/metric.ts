import { METRIC_FIELDS, type Bind, type Threshold } from "@hx-aioa/protocol";
import { h } from "../core/dom";
import type { Point, Store } from "../core/store";
import { fmtNum, lastValue, levelOf, mountWidget, type Ctx } from "./frame";

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function thresholdFor(ctx: Ctx, b: Bind): Threshold {
  const p = ctx.item.props ?? {};
  const t = ctx.store.thresholdOf(b) ?? {};
  return {
    warn: typeof p.warn === "number" ? p.warn : t.warn,
    crit: typeof p.crit === "number" ? p.crit : t.crit,
  };
}

export function unitFor(ctx: Ctx, b: Bind): string {
  if (typeof ctx.item.props?.unit === "string") return ctx.item.props.unit;
  return ctx.store.unitOf(b) || (METRIC_FIELDS[b.field]?.unit ?? "");
}

const hasSeries = (store: Store, binds: Bind[]) => () => binds.some((b) => store.seriesOf(b).length > 0);

function bigValue(ctx: Ctx, b: Bind): HTMLElement {
  const v = lastValue(ctx.store, b) ?? 0;
  const th = thresholdFor(ctx, b);
  return h(
    "div",
    { class: `big lv-${levelOf(v, th.warn, th.crit)}` },
    h("span", { class: "num" }, fmtNum(v)),
    h("span", { class: "unit" }, unitFor(ctx, b)),
  );
}

export function renderValue(ctx: Ctx): HTMLElement {
  const binds = ctx.item.bind ?? [];
  return mountWidget(ctx, {
    binds,
    hasData: hasSeries(ctx.store, binds),
    render: (body) => {
      const b = binds[0]!;
      const pts = ctx.store.seriesOf(b);
      body.append(bigValue(ctx, b));
      const first = pts[0];
      const lastP = pts.at(-1);
      if (first && lastP && pts.length > 1) {
        const d = lastP.v - first.v;
        const label = typeof ctx.item.props?.label === "string" ? ctx.item.props.label : b.subject;
        body.append(h("div", { class: "sub" }, `${label} · ${b.range ?? "区间"}内 ${d >= 0 ? "+" : ""}${fmtNum(d)}`));
      }
    },
  });
}

export function sparkPath(pts: Point[], w: number, hgt: number, pad = 2): { line: string; area: string } {
  if (!pts.length) return { line: "", area: "" };
  const vs = pts.map((p) => p.v);
  const min = Math.min(...vs);
  const span = Math.max(...vs) - min || 1;
  const t0 = pts[0]!.ts;
  const tspan = pts.at(-1)!.ts - t0 || 1;
  const xy = pts.map((p) => [((p.ts - t0) / tspan) * w, hgt - pad - ((p.v - min) / span) * (hgt - pad * 2)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  return { line, area: `${line}L${w} ${hgt}L0 ${hgt}Z` };
}

export function renderSparkline(ctx: Ctx): HTMLElement {
  const binds = ctx.item.bind ?? [];
  return mountWidget(ctx, {
    binds,
    hasData: hasSeries(ctx.store, binds),
    render: (body) => {
      const b = binds[0]!;
      const W = 120;
      const H = 36;
      const { line, area } = sparkPath(ctx.store.seriesOf(b), W, H);
      const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark", preserveAspectRatio: "none" });
      s.append(svg("path", { d: area, class: "spark-area" }), svg("path", { d: line, class: "spark-line" }));
      body.append(h("div", { class: "spark-row" }, bigValue(ctx, b), s));
    },
  });
}

export function renderRing(ctx: Ctx): HTMLElement {
  const binds = ctx.item.bind ?? [];
  return mountWidget(ctx, {
    binds,
    hasData: hasSeries(ctx.store, binds),
    render: (body) => {
      const b = binds[0]!;
      const max = Number(ctx.item.props?.max ?? 100);
      const v = lastValue(ctx.store, b) ?? 0;
      const ratio = Math.max(0, Math.min(1, v / max));
      const th = thresholdFor(ctx, b);
      const R = 34;
      const C = 2 * Math.PI * R;
      const s = svg("svg", { viewBox: "0 0 80 80", class: `ring lv-${levelOf(v, th.warn, th.crit)}` });
      s.append(
        svg("circle", { cx: 40, cy: 40, r: R, class: "ring-track" }),
        svg("circle", { cx: 40, cy: 40, r: R, class: "ring-bar", "stroke-dasharray": `${(C * ratio).toFixed(1)} ${C.toFixed(1)}` }),
      );
      const label = h("div", { class: "ring-label" }, h("span", { class: "num" }, fmtNum(v, 0)), h("span", { class: "unit" }, unitFor(ctx, b)));
      body.append(h("div", { class: "ring-wrap" }, s, label));
    },
  });
}
