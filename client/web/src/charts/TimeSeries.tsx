import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LOCALE } from "../core/constants";
import { palette, paletteChanged, seriesColor } from "./palette";
import type { SeriesBuffer } from "./source";
import { fmt, TimeChart, type Hover, type SeriesDef } from "./timechart";

type Props = { source: SeriesBuffer; series: SeriesDef[]; unit: string; windowMs: number; yMax?: number; className?: string };
const usePalette = () => useSyncExternalStore((fn) => paletteChanged.on(fn), palette);

// 时序图的 React 外壳: 画布由 TimeChart 管, 数据变化不经过 React; 这里只放图例与悬停提示
export function TimeSeries({ source, series, unit, windowMs, yMax, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<TimeChart | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const pal = usePalette();

  useEffect(() => {
    if (!host.current) return;
    const c = new TimeChart(host.current, source, series, {
      windowMs,
      yMax,
      onHover: (h) => setHover((old) => (old === null && h === null ? old : h)),
    });
    chart.current = c;
    return () => {
      c.destroy();
      chart.current = null;
    };
    // 序列变化走 setDefs, 不重建画布
  }, [source, windowMs, yMax]);

  useEffect(() => chart.current?.setDefs(series), [series]);
  useEffect(() => chart.current?.setHidden(hidden), [hidden]);

  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-1">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => toggle(s.key)}
            aria-pressed={!hidden.has(s.key)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted ${hidden.has(s.key) ? "text-muted-foreground line-through" : "text-foreground"}`}
          >
            <svg className="size-2.5" viewBox="0 0 10 10" aria-hidden>
              <circle cx="5" cy="5" r="5" fill={seriesColor(pal, s.color)} />
            </svg>
            {s.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">拖选放大, 双击复位</span>
      </div>
      <div ref={host} className="relative h-56 w-full select-none" onDoubleClick={() => chart.current?.resetZoom()}>
        {hover && hover.values.length > 0 && <Tip hover={hover} unit={unit} width={host.current?.clientWidth ?? 0} />}
      </div>
    </div>
  );
}

function Tip({ hover, unit, width }: { hover: Hover; unit: string; width: number }) {
  const pal = palette();
  const left = hover.x > width / 2 ? hover.x - 12 : hover.x + 12;
  const style = { left, top: hover.y, transform: hover.x > width / 2 ? "translateX(-100%)" : undefined };
  return (
    <div style={style} className="pointer-events-none absolute z-10 min-w-32 rounded-md border border-border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 text-muted-foreground">{new Date(hover.ts).toLocaleTimeString(LOCALE)}</div>
      {hover.values.map(({ def, value }) => (
        <div key={def.key} className="flex items-center gap-2">
          <svg className="size-2" viewBox="0 0 10 10" aria-hidden>
            <circle cx="5" cy="5" r="5" fill={seriesColor(pal, def.color)} />
          </svg>
          <span className="flex-1">{def.label}</span>
          <span className="tabular-nums">
            {fmt(value)}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}
