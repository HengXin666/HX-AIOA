import { HoverCard, HoverCardContent, HoverCardTrigger } from "@hx/ui/ui/hover-card";
import type { Turn } from "../../../agentgui/reduce";
import type { Stats, Usage } from "../../../agentgui/types";
import { duration, kTok, pct } from "./parts";

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-foreground tabular-nums">{v}</span>
    </div>
  );
}

// 统计条: 上下文 · tok/s · 缓存 · 费用; 探针的 stats 帧优先, 没有就用 ACP usage_update 与上一轮的 usage
export function StatsBar({ stats, usage, last }: { stats: Stats | null; usage: Usage | null; last?: Turn }) {
  const ctx = stats?.ctx ?? (usage && usage.size ? ([usage.used, usage.size] as [number, number]) : null);
  const u = last?.usage;
  const hit = stats?.hit ?? (u?.cacheRead !== undefined && u.input ? u.cacheRead / (u.input + u.cacheRead + (u.cacheWrite ?? 0)) : undefined);
  const cost = stats?.cost ?? usage?.cost?.amount;
  const bits: string[] = [];
  if (ctx) bits.push(`上下文 ${pct(ctx[0] / ctx[1])} (${kTok(ctx[0])} / ${kTok(ctx[1])})`);
  if (stats?.tps) bits.push(`${stats.est ? "约 " : ""}${Math.round(stats.tps)} tok/s`);
  if (hit !== undefined) bits.push(`缓存命中 ${pct(hit)}`);
  if (cost !== undefined) bits.push(`$${cost.toFixed(2)}`);
  if (bits.length === 0) return <div className="h-6" />;
  const ms = stats?.ms ?? (last?.start && last.end ? last.end - last.start : 0);
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <p tabIndex={0} className="mx-auto h-6 w-full max-w-[768px] cursor-default truncate px-2 text-center text-xs leading-6 text-muted-foreground tabular-nums">
          {bits.join("  ·  ")}
        </p>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="flex w-72 flex-col gap-1.5">
        {ctx && <Row k="上下文" v={`${ctx[0].toLocaleString()} / ${ctx[1].toLocaleString()}`} />}
        <Row k="输入 / 输出" v={`${kTok(stats?.in ?? u?.input ?? 0)} / ${kTok(stats?.out ?? u?.output ?? 0)}`} />
        <Row k="缓存读 / 写" v={`${kTok(stats?.cr ?? u?.cacheRead ?? 0)} / ${kTok(stats?.cw ?? u?.cacheWrite ?? 0)}`} />
        {ms > 0 && <Row k="本轮用时" v={duration(ms)} />}
        {stats?.tps !== undefined && <Row k="tok/s" v={`${stats.est ? "约 " : ""}${Math.round(stats.tps)}${stats.est ? " (估算, 轮末校准)" : ""}`} />}
        {cost !== undefined && <Row k="累计费用" v={`$${cost.toFixed(3)}`} />}
      </HoverCardContent>
    </HoverCard>
  );
}
