import { useSyncExternalStore } from "react";
import { palette, paletteChanged, seriesColor } from "./palette";

const usePalette = () => useSyncExternalStore((fn) => paletteChanged.on(fn), palette);

// 迷你折线: 一个 path; 值缺失 (NaN) 处断开
export function sparkPath(values: number[], w: number, h: number, max?: number): string {
  const vs = values.filter((v) => !Number.isNaN(v));
  if (vs.length < 2) return "";
  const hi = max ?? Math.max(...vs, 1e-9);
  const step = w / (values.length - 1);
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (Number.isNaN(v)) {
      pen = false;
      return;
    }
    const x = (i * step).toFixed(1);
    const y = (h - 1 - (Math.min(v, hi) / hi) * (h - 2)).toFixed(1);
    d += `${pen ? "L" : "M"}${x} ${y}`;
    pen = true;
  });
  return d;
}

export function Sparkline({ values, max, color = 0, className }: { values: number[]; max?: number; color?: number; className?: string }) {
  const pal = usePalette();
  const W = 100;
  const H = 28;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className ?? "h-7 w-full"} aria-hidden>
      <path d={sparkPath(values, W, H, max)} fill="none" stroke={seriesColor(pal, color)} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// 环: 底圈一个 circle, 值一段弧 path
export function ringPath(frac: number, r: number, c: number): string {
  const f = Math.min(Math.max(frac, 0), 0.9999);
  if (f <= 0) return "";
  const a = f * Math.PI * 2 - Math.PI / 2;
  const x = c + r * Math.cos(a);
  const y = c + r * Math.sin(a);
  return `M${c} ${c - r}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}

export function Ring({ value, max = 100, color = 0, label, size = 56 }: { value: number; max?: number; color?: number; label?: string; size?: number }) {
  const pal = usePalette();
  const S = 40;
  const R = 16;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={size} height={size} role="img" aria-label={label}>
      <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke={pal.track} strokeWidth="5" />
      <path d={ringPath(value / max, R, S / 2)} fill="none" stroke={seriesColor(pal, color)} strokeWidth="5" strokeLinecap="round" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-foreground text-[9px]">
        {Number.isFinite(value) ? Math.round(value) : "-"}
      </text>
    </svg>
  );
}

// 热力格: 每级颜色一条 path (5 个节点), 按周一对齐成列
export function Heatmap({ days, cell = 11, gap = 2 }: { days: { date: string; commits: number }[]; cell?: number; gap?: number }) {
  const pal = usePalette();
  if (!days.length) return null;
  const max = Math.max(...days.map((d) => d.commits), 1);
  const first = (new Date(`${days[0]!.date}T00:00:00`).getDay() + 6) % 7;
  const paths = ["", "", "", "", ""];
  const step = cell + gap;
  days.forEach((d, i) => {
    const k = i + first;
    const level = d.commits <= 0 ? 0 : Math.min(4, Math.ceil((d.commits / max) * 4));
    paths[level] += `M${Math.floor(k / 7) * step} ${(k % 7) * step}h${cell}v${cell}h${-cell}z`;
  });
  const cols = Math.ceil((days.length + first) / 7);
  return (
    <svg width={cols * step} height={7 * step} role="img" aria-label="提交热力格">
      {paths.map((d, i) => (d ? <path key={i} d={d} fill={pal.heat[i]} /> : null))}
    </svg>
  );
}
