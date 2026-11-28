import { LIVE_DRAW_GAP_MS, LOCALE } from "../core/constants";
import { palette, paletteChanged, seriesColor } from "./palette";
import type { SeriesBuffer, SourceChange } from "./source";

export type SeriesDef = { key: string; label: string; color: number };
export type ChartOpts = { windowMs: number; yMax?: number; onHover?: (h: Hover | null) => void };
export type Hover = { x: number; y: number; ts: number; values: { def: SeriesDef; value: number }[] };

const PAD = { l: 44, r: 10, t: 10, b: 22 };
const GRID_LINES = 4;
const DRAG_MIN_PX = 6;
const FONT = "11px system-ui, sans-serif";
type Dirty = 0 | 1 | 2;

/**
 * Canvas 时序图: 实时跟随时新点只把绘图区左移整数像素再补右边一段 (增量), 缩放, 改尺寸, 换主题, 量程变了才整张重画。
 * 底层画网格与线, 上层画时间刻度, 十字线, 拖选框。不可见 (IntersectionObserver, 页面隐藏) 不画, 实时最多 1 次 / 秒。
 */
export class TimeChart {
  private base: HTMLCanvasElement;
  private over: HTMLCanvasElement;
  private scratch: HTMLCanvasElement | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private hidden = new Set<string>();
  private zoom: [number, number] | null = null;
  private end = 0;
  private yMax = 1;
  private drawn = false;
  private dirty: Dirty = 0;
  private lastDraw = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private raf = 0;
  private inView = false;
  private hoverX: number | null = null;
  private drag: number | null = null;
  private dragTo: number | null = null;
  private lastTs = 0;
  private offs: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly src: SeriesBuffer,
    private defs: SeriesDef[],
    private readonly opts: ChartOpts,
  ) {
    this.base = layer(host);
    this.over = layer(host);
    this.over.style.touchAction = "pan-y";
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    const io = new IntersectionObserver((es) => {
      this.inView = es.some((e) => e.isIntersecting);
      if (this.inView) this.request(2);
    });
    io.observe(host);
    const onVis = () => document.visibilityState === "visible" && this.request(2);
    document.addEventListener("visibilitychange", onVis);
    this.offs.push(
      () => ro.disconnect(),
      () => io.disconnect(),
      () => document.removeEventListener("visibilitychange", onVis),
      src.changed.on((c) => this.onData(c)),
      paletteChanged.on(() => this.request(2)),
    );
    this.bindPointer();
    this.resize();
  }

  destroy(): void {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    for (const off of this.offs) off();
    this.base.remove();
    this.over.remove();
  }

  setDefs(defs: SeriesDef[]): void {
    this.defs = defs;
    this.request(2);
  }

  setHidden(keys: Set<string>): void {
    this.hidden = new Set(keys);
    this.request(2);
  }

  resetZoom(): void {
    this.zoom = null;
    this.request(2);
  }

  private onData(c: SourceChange): void {
    this.request(c === "reset" || this.zoom || !this.drawn ? 2 : 1);
  }

  private visible(): boolean {
    return this.inView && document.visibilityState === "visible" && this.w > 0;
  }

  // 数据驱动的重画最多 1 次 / 秒; 交互 (now) 立即在下一帧画
  private request(kind: Dirty, now = false): void {
    if (kind > this.dirty) this.dirty = kind;
    if (!this.visible()) {
      this.dirty = 2;
      return;
    }
    if (this.raf || this.timer) return;
    const wait = now || kind === 2 ? 0 : Math.max(0, this.lastDraw + LIVE_DRAW_GAP_MS - Date.now());
    const go = () => {
      this.timer = undefined;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.flush();
      });
    };
    if (wait > 0) this.timer = setTimeout(go, wait);
    else go();
  }

  private resize(): void {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.floor(r.width);
    this.h = Math.floor(r.height);
    for (const c of [this.base, this.over]) {
      c.width = Math.max(1, Math.round(this.w * this.dpr));
      c.height = Math.max(1, Math.round(this.h * this.dpr));
      c.style.width = `${this.w}px`;
      c.style.height = `${this.h}px`;
    }
    this.request(2, true);
  }

  private flush(): void {
    const d = this.dirty;
    this.dirty = 0;
    if (!this.visible()) {
      this.dirty = 2;
      return;
    }
    if (d === 2 || !this.drawn) this.drawBase();
    else if (d === 1 && !this.tryAppend()) this.drawBase();
    if (d > 0) this.lastDraw = Date.now();
    this.drawOver();
  }

  private plot() {
    return { x: PAD.l, y: PAD.t, w: Math.max(1, this.w - PAD.l - PAD.r), h: Math.max(1, this.h - PAD.t - PAD.b) };
  }

  private range(): [number, number] {
    if (this.zoom) return this.zoom;
    return [this.end - this.opts.windowMs, this.end];
  }

  private shown(): SeriesDef[] {
    return this.defs.filter((d) => !this.hidden.has(d.key));
  }

  private computeYMax(a: number, b: number): number {
    if (this.opts.yMax !== undefined) return this.opts.yMax;
    let max = 0;
    const ts = this.src.ts;
    for (const d of this.shown()) {
      const v = this.src.values(d.key);
      for (let i = lowerBound(ts, a); i < ts.length && ts[i]! <= b; i++) if (v[i]! > max) max = v[i]!;
    }
    return niceMax(max * 1.1);
  }

  private drawBase(): void {
    const ts = this.src.ts;
    this.end = ts[ts.length - 1] ?? Date.now();
    this.lastTs = this.end;
    const [a, b] = this.range();
    this.yMax = this.computeYMax(a, b);
    const ctx = this.base.getContext("2d")!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const p = this.plot();
    const pal = palette();
    ctx.font = FONT;
    ctx.fillStyle = pal.axis;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= GRID_LINES; i++) ctx.fillText(fmt((this.yMax * i) / GRID_LINES), p.x - 6, p.y + p.h - (p.h * i) / GRID_LINES);
    this.drawPlot(ctx, p.x, p.x + p.w, lowerBound(ts, a) - 1);
    this.drawn = true;
  }

  // 绘图区 [x0, x1] 一段: 网格 + 从下标 from 起的线
  private drawPlot(ctx: CanvasRenderingContext2D, x0: number, x1: number, from: number): void {
    const p = this.plot();
    const pal = palette();
    const [a, b] = this.range();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, p.y - 2, x1 - x0, p.h + 4);
    ctx.clip();
    ctx.clearRect(x0, p.y - 2, x1 - x0, p.h + 4);
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= GRID_LINES; i++) {
      const y = Math.round(p.y + p.h - (p.h * i) / GRID_LINES) + 0.5;
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
    const ts = this.src.ts;
    const sx = p.w / (b - a || 1);
    const sy = p.h / (this.yMax || 1);
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    for (const d of this.shown()) {
      const v = this.src.values(d.key);
      ctx.strokeStyle = seriesColor(pal, d.color);
      ctx.beginPath();
      let pen = false;
      for (let i = Math.max(0, from); i < ts.length; i++) {
        const t = ts[i]!;
        const y = v[i]!;
        if (Number.isNaN(y)) {
          pen = false;
          continue;
        }
        const px = p.x + (t - a) * sx;
        const py = p.y + p.h - Math.min(y, this.yMax) * sy;
        if (pen) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        pen = true;
        if (t > b) break;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 增量: 只在实时跟随, 量程不变, 新点都在后面时成立; 否则返回 false 整张重画
  private tryAppend(): boolean {
    if (this.zoom) return false;
    const ts = this.src.ts;
    const newEnd = ts[ts.length - 1];
    if (newEnd === undefined || newEnd < this.lastTs) return false;
    const from = lowerBound(ts, this.lastTs);
    const [a] = this.range();
    if (this.computeYMax(a + (newEnd - this.end), newEnd) !== this.yMax) return false;
    const p = this.plot();
    const pxPerMs = (p.w * this.dpr) / this.opts.windowMs;
    const n = Math.round((newEnd - this.end) * pxPerMs);
    if (n >= p.w * this.dpr) return false;
    const ctx = this.base.getContext("2d")!;
    if (n > 0) {
      const X = Math.round(p.x * this.dpr);
      const Y = Math.round((p.y - 2) * this.dpr);
      const W = Math.round(p.w * this.dpr);
      const H = Math.round((p.h + 4) * this.dpr);
      // 画到自身会叠在旧像素上, 先拷到暂存画布, 清掉再贴回
      const tmp = (this.scratch ??= document.createElement("canvas"));
      tmp.width = W;
      tmp.height = H;
      tmp.getContext("2d")!.drawImage(this.base, X + n, Y, W - n, H, 0, 0, W - n, H);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(X, Y, W, H);
      ctx.drawImage(tmp, 0, 0, W - n, H, X, Y, W - n, H);
      this.end += n / pxPerMs;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const strip = Math.max(n / this.dpr, 0) + 2;
    this.drawPlot(ctx, p.x + p.w - strip, p.x + p.w, from - 1);
    this.lastTs = newEnd;
    return true;
  }

  private drawOver(): void {
    const ctx = this.over.getContext("2d")!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const p = this.plot();
    const pal = palette();
    const [a, b] = this.range();
    ctx.font = FONT;
    ctx.fillStyle = pal.axis;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const ticks = Math.max(2, Math.floor(p.w / 90));
    for (let i = 0; i <= ticks; i++) {
      const t = a + ((b - a) * i) / ticks;
      ctx.textAlign = i === 0 ? "left" : i === ticks ? "right" : "center";
      ctx.fillText(clock(t, b - a), p.x + (p.w * i) / ticks, p.y + p.h + 6);
    }
    if (this.drag !== null && this.dragTo !== null) {
      ctx.fillStyle = pal.grid;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(Math.min(this.drag, this.dragTo), p.y, Math.abs(this.dragTo - this.drag), p.h);
      ctx.globalAlpha = 1;
    }
    this.drawHover(ctx);
  }

  private drawHover(ctx: CanvasRenderingContext2D): void {
    const hx = this.hoverX;
    const ts = this.src.ts;
    if (hx === null || !ts.length) return this.opts.onHover?.(null);
    const p = this.plot();
    const [a, b] = this.range();
    const t = a + ((hx - p.x) / p.w) * (b - a);
    let i = lowerBound(ts, t);
    if (i >= ts.length || (i > 0 && t - ts[i - 1]! < ts[i]! - t)) i -= 1;
    const at = ts[i]!;
    if (at < a || at > b) return this.opts.onHover?.(null);
    const x = p.x + ((at - a) / (b - a)) * p.w;
    const pal = palette();
    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, p.y);
    ctx.lineTo(Math.round(x) + 0.5, p.y + p.h);
    ctx.stroke();
    const values: Hover["values"] = [];
    for (const d of this.shown()) {
      const v = this.src.values(d.key)[i]!;
      if (Number.isNaN(v)) continue;
      values.push({ def: d, value: v });
      ctx.fillStyle = seriesColor(pal, d.color);
      ctx.beginPath();
      ctx.arc(x, p.y + p.h - (Math.min(v, this.yMax) / (this.yMax || 1)) * p.h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    this.opts.onHover?.({ x, y: p.y, ts: at, values });
  }

  private bindPointer(): void {
    const el = this.over;
    const pos = (e: PointerEvent) => e.clientX - el.getBoundingClientRect().left;
    const move = (e: PointerEvent) => {
      this.hoverX = pos(e);
      if (this.drag !== null) this.dragTo = this.hoverX;
      this.request(0, true);
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return move(e);
      this.drag = pos(e);
      this.dragTo = null;
      el.setPointerCapture(e.pointerId);
    };
    const up = (e: PointerEvent) => {
      if (this.drag === null) return;
      const x0 = this.drag;
      const x1 = pos(e);
      this.drag = null;
      this.dragTo = null;
      if (Math.abs(x1 - x0) >= DRAG_MIN_PX) {
        const p = this.plot();
        const [a, b] = this.range();
        const at = (x: number) => a + ((Math.min(Math.max(x, p.x), p.x + p.w) - p.x) / p.w) * (b - a);
        this.zoom = [at(Math.min(x0, x1)), at(Math.max(x0, x1))];
        return this.request(2, true);
      }
      this.request(0, true);
    };
    const leave = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      this.hoverX = null;
      this.request(0, true);
    };
    const dbl = () => this.resetZoom();
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("dblclick", dbl);
  }
}

function layer(host: HTMLElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.style.position = "absolute";
  c.style.inset = "0";
  host.appendChild(c);
  return c;
}

export function lowerBound(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function fmt(v: number): string {
  if (v >= 1e9) return `${+(v / 1e9).toFixed(1)}G`;
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${+(v / 1e3).toFixed(1)}k`;
  return String(+v.toFixed(v < 10 ? 2 : 1));
}

const clock = (t: number, span: number) =>
  new Date(t).toLocaleTimeString(LOCALE, span < 600_000 ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
