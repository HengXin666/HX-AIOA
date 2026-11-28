import { Emitter } from "../core/emitter";

// 图表调色板: 色值全部来自 HX-UI 令牌 (--chart-1..5 等), 只做两件事: 按语义挑色, 按底色把对比度补到 3:1。
// 算法移植自安卓 kit/ChartPalette.kt, 两端同一套参数。
export const CHART_MIN_CONTRAST = 3;
const FIX_STEP = 0.05;
const FIX_MAX = 0.6;
const CHROMA_MIN = 0.12;
const HEAT_STOPS = [0.34, 0.56, 0.78, 1];

export type Rgb = [number, number, number];
export type Palette = { series: string[]; heat: string[]; grid: string; axis: string; track: string; dark: boolean };

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const css = ([r, g, b]: Rgb) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
export const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function channel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastOf(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// 对比度不够时往远离底色的方向 (浅色变暗, 深色变亮) 一点点混, 色相不变
export function ensureContrast(x: Rgb, bgs: Rgb[], dark: boolean, min = CHART_MIN_CONTRAST): Rgb {
  const toward: Rgb = dark ? [1, 1, 1] : [0, 0, 0];
  let k = 0;
  let out = x;
  while (Math.min(...bgs.map((b) => contrastOf(out, b))) < min && k < FIX_MAX) {
    k += FIX_STEP;
    out = lerp(x, toward, k);
  }
  return out;
}

const chroma = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);

// 令牌可能是 oklch: 交给 canvas 换成 sRGB, 不自己解析颜色语法
let probe: CanvasRenderingContext2D | null = null;
export function toRgb(color: string): Rgb | null {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe || !color.trim()) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#010203";
  probe.fillStyle = color.trim();
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  if (a === 0) return null;
  return [clamp((r ?? 0) / 255), clamp((g ?? 0) / 255), clamp((b ?? 0) / 255)];
}

const GRAY: Rgb = [0.5, 0.5, 0.5];

function compute(): Palette {
  const st = getComputedStyle(document.documentElement);
  const tok = (name: string) => toRgb(st.getPropertyValue(`--${name}`)) ?? GRAY;
  const dark = document.documentElement.classList.contains("dark");
  const bgs = [tok("background"), tok("card")];
  const fix = (x: Rgb) => ensureContrast(x, bgs, dark);
  const c1 = tok("chart-1");
  const primary = fix(chroma(c1) >= CHROMA_MIN ? c1 : tok("info"));
  const track = tok("muted");
  // 顺序与安卓一致: 蓝, 琥珀, 青, 品红, 绿, 灰, 红 (红绿不相邻, 冷暖交替)
  const series = [primary, fix(tok("chart-3")), fix(tok("chart-2")), fix(tok("chart-4")), fix(tok("chart-5")), fix(tok("muted-foreground")), fix(tok("destructive"))];
  const heat = [track, ...HEAT_STOPS.map((s) => lerp(track, primary, s))];
  return { series: series.map(css), heat: heat.map(css), grid: css(tok("border")), axis: css(tok("muted-foreground")), track: css(track), dark };
}

export const paletteChanged = new Emitter<void>();
let cached: Palette | null = null;
let watching = false;

function watch(): void {
  if (watching) return;
  watching = true;
  const reset = () => {
    cached = null;
    paletteChanged.emit();
  };
  new MutationObserver(reset).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
}

export function palette(): Palette {
  watch();
  cached ??= compute();
  return cached;
}

export const seriesColor = (p: Palette, i: number) => p.series[((i % p.series.length) + p.series.length) % p.series.length]!;
