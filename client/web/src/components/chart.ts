import type { Bind } from "@hx-aioa/protocol";
import { h, timeText } from "../core/dom";
import type { Point } from "../core/store";
import { fmtNum, mountWidget, type Ctx } from "./frame";
import { svg, thresholdFor, unitFor } from "./metric";

const HEIGHT = 140;
const PAD = { l: 34, r: 8, t: 8, b: 20 };
const TICKS = 3;

function niceTicks(min: number, max: number, n: number): number[] {
  const span = max - min || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((s) => s * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

type Geo = { w: number; x: (ts: number) => number; y: (v: number) => number; t0: number; t1: number; lo: number; hi: number };

function geometry(all: Point[][], w: number, extra: number[]): Geo {
  const flat = all.flat();
  const vs = [...flat.map((p) => p.v), ...extra];
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs), TICKS);
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const t0 = Math.min(...flat.map((p) => p.ts));
  const t1 = Math.max(...flat.map((p) => p.ts));
  const iw = w - PAD.l - PAD.r;
  const ih = HEIGHT - PAD.t - PAD.b;
  return {
    w,
    t0,
    t1,
    lo,
    hi,
    x: (ts) => PAD.l + ((ts - t0) / (t1 - t0 || 1)) * iw,
    y: (v) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih,
  };
}

function axes(g: Geo, s: SVGSVGElement): void {
  for (const v of niceTicks(g.lo, g.hi, TICKS)) {
    const y = g.y(v);
    s.append(svg("line", { x1: PAD.l, x2: g.w - PAD.r, y1: y, y2: y, class: "grid" }));
    const t = svg("text", { x: PAD.l - 6, y: y + 4, class: "tick", "text-anchor": "end" });
    t.textContent = fmtNum(v, 0);
    s.append(t);
  }
  for (let i = 0; i <= 2; i++) {
    const ts = g.t0 + ((g.t1 - g.t0) * i) / 2;
    const anchor = i === 0 ? "start" : i === 2 ? "end" : "middle";
    const t = svg("text", { x: g.x(ts), y: HEIGHT - 4, class: "tick", "text-anchor": anchor });
    t.textContent = timeText(ts);
    s.append(t);
  }
}

function pathOf(pts: Point[], g: Geo): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${g.x(p.ts).toFixed(1)} ${g.y(p.v).toFixed(1)}`).join("");
}

function nearest(pts: Point[], ts: number): Point | undefined {
  let best: Point | undefined;
  for (const p of pts) if (!best || Math.abs(p.ts - ts) < Math.abs(best.ts - ts)) best = p;
  return best;
}

// 折线图: 当前值 + 单位, 最大最小, 轴刻度, 悬停十字线与气泡, 可选阈值线
export function renderLine(ctx: Ctx): HTMLElement {
  const binds = ctx.item.bind ?? [];
  let hoverRatio: number | null = null;
  let width = 0;
  const host = mountWidget(ctx, {
    binds,
    hasData: () => binds.some((b) => ctx.store.seriesOf(b).length > 1),
    render: (body) => draw(ctx, binds, body, width, () => hoverRatio, (r) => (hoverRatio = r)),
  });
  const ro = new ResizeObserver(([e]) => {
    const w = Math.round(e?.contentRect.width ?? 0);
    if (w && Math.abs(w - width) > 4) {
      width = w;
      ctx.store.emit(`${binds[0]?.subject}|${binds[0]?.field}`);
    }
  });
  ro.observe(host);
  ctx.scope.add(() => ro.disconnect());
  return host;
}

function draw(ctx: Ctx, binds: Bind[], body: HTMLElement, width: number, getHover: () => number | null, setHover: (r: number | null) => void): void {
  const series = binds.map((b) => ctx.store.seriesOf(b));
  const main = series[0] ?? [];
  const b0 = binds[0]!;
  const unit = unitFor(ctx, b0);
  const vs = main.map((p) => p.v);
  const th = thresholdFor(ctx, b0);
  const lines = [th.warn, th.crit].filter((v): v is number => typeof v === "number");
  const showTh = ctx.item.props?.threshold !== false;
  const cur = main.at(-1)?.v ?? 0;
  body.append(
    h(
      "div",
      { class: "chart-head" },
      h("div", { class: "big" }, h("span", { class: "num" }, fmtNum(cur)), h("span", { class: "unit" }, unit)),
      h("div", { class: "minmax" }, `最高 ${fmtNum(Math.max(...vs))}${unit}`, h("br"), `最低 ${fmtNum(Math.min(...vs))}${unit}`),
    ),
  );
  const w = Math.max(200, width || 300);
  const g = geometry(series.filter((s) => s.length), w, showTh ? lines : []);
  const s = svg("svg", { width: w, height: HEIGHT, class: "chart", viewBox: `0 0 ${w} ${HEIGHT}` });
  axes(g, s);
  if (showTh) {
    lines.forEach((v, i) => s.append(svg("line", { x1: PAD.l, x2: w - PAD.r, y1: g.y(v), y2: g.y(v), class: i ? "th th-crit" : "th" })));
  }
  series.forEach((pts, i) => {
    if (i === 0) s.append(svg("path", { d: `${pathOf(pts, g)}L${g.x(g.t1)} ${g.y(g.lo)}L${g.x(g.t0)} ${g.y(g.lo)}Z`, class: "chart-area" }));
    s.append(svg("path", { d: pathOf(pts, g), class: `chart-line c${i}` }));
  });
  const cross = svg("line", { y1: PAD.t, y2: HEIGHT - PAD.b, class: "cross" });
  const dot = svg("circle", { r: 4, class: "cross-dot" });
  const tip = h("div", { class: "tip" });
  const wrap = h("div", { class: "chart-wrap" }, s, tip);
  s.append(cross, dot);
  const show = (ratio: number | null) => {
    wrap.classList.toggle("hovering", ratio !== null);
    if (ratio === null) return;
    const p = nearest(main, g.t0 + ratio * (g.t1 - g.t0));
    if (!p) return;
    const x = g.x(p.ts);
    cross.setAttribute("x1", String(x));
    cross.setAttribute("x2", String(x));
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(g.y(p.v)));
    tip.textContent = `${fmtNum(p.v)}${unit} · ${timeText(p.ts)}`;
    tip.style.left = `${Math.min(Math.max(x, 50), w - 50)}px`;
  };
  const move = (e: PointerEvent) => {
    const rect = s.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.l) / (rect.width - PAD.l - PAD.r)));
    setHover(ratio);
    show(ratio);
  };
  s.addEventListener("pointermove", move);
  s.addEventListener("pointerdown", move);
  s.addEventListener("pointerleave", () => {
    setHover(null);
    show(null);
  });
  show(getHover());
  body.append(wrap);
}
