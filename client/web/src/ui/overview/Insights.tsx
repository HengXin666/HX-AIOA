import type { Envelope } from "@hx-aioa/protocol";
import { Donut, Gauge, HeatCalendar, Rose } from "@hx/ui/data";
import { Skeleton } from "@hx/ui/ui/skeleton";
import { CalendarDays, Clock4, PieChart } from "lucide-react";
import { useMemo } from "react";
import { useUser } from "../../app/hooks";
import { chats, groupOf, titleOf } from "../../core/chats";
import { CLOUD_AGENT_LABEL } from "../../core/constants";
import { DAY_HOURS, useActivity } from "../shell/activity";
import { useAgentSids } from "./Pulse";
import { Fact, Quiet, Section, TONE } from "./parts";

const HEAT_WEEKS = 40;
const TOP_SOURCES = 5;
const OTHER = "其它";
const HUNDRED = 100;
const ROSE_SIZE = 300;
const DONUT_SIZE = 168;
const SOURCE_COLORS = [TONE.info, TONE.accent, TONE.success, TONE.warning, "var(--chart-5)", TONE.muted];
// 玫瑰图只标这几个钟点, 其余留空, 外圈不挤
const HOUR_TICKS = new Set([0, 6, 12, 18]);

const OTHER_SOURCES = "通知与其它";
const total = (r: { mine: number; agent: number; other: number }) => r.mine + r.agent + r.other;
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// 活跃时段: 把最近的消息按一天里的钟点叠起来, 我, 群 Agent, 其它来源分三层, 一眼看出什么时候最忙
export function Rhythm({ className }: { className?: string }) {
  const events = useActivity();
  const uid = useUser()?.id ?? "";
  const sids = useAgentSids();
  const { data, peak } = useMemo(() => {
    const rows = Array.from({ length: DAY_HOURS }, (_, h) => ({ label: HOUR_TICKS.has(h) ? `${h} 时` : `${pad(h)}`, mine: 0, agent: 0, other: 0 }));
    for (const e of events ?? []) {
      const r = rows[new Date(e.ts).getHours()]!;
      if (e.by === uid) r.mine++;
      else if (sids.has(e.source.id)) r.agent++;
      else r.other++;
    }
    let best = 0;
    rows.forEach((r, h) => {
      if (total(r) > total(rows[best]!)) best = h;
    });
    return { data: rows, peak: total(rows[best]!) ? best : null };
  }, [events, uid, sids]);
  return (
    <Section title="活跃时段" icon={<Clock4 />} tone="primary" className={className} hint={peak === null ? "按钟点叠加最近的消息" : `最忙在 ${pad(peak)}:00 前后`}>
      {!events ? (
        <Skeleton className="mx-auto aspect-square w-full max-w-[300px] rounded-full" />
      ) : peak === null ? (
        <Quiet icon={<Clock4 />}>还没有消息</Quiet>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Rose
            data={data}
            series={[
              { key: "mine", name: "我", color: TONE.primary },
              { key: "agent", name: CLOUD_AGENT_LABEL, color: TONE.accent },
              { key: "other", name: OTHER_SOURCES, color: TONE.success },
            ]}
            innerRadius={0.22}
            size={ROSE_SIZE}
            unit="条"
            ariaLabel="一天里各钟点的消息数"
          />
        </div>
      )}
    </Section>
  );
}

// 活跃日历: 每天一个格子, 颜色越深那天消息越多
export function Heat({ className }: { className?: string }) {
  const events = useActivity();
  const values = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of events ?? []) out[isoDay(e.ts)] = (out[isoDay(e.ts)] ?? 0) + 1;
    return out;
  }, [events]);
  const days = Object.keys(values).length;
  return (
    <Section title="活跃日历" icon={<CalendarDays />} tone="success" className={className} hint={days ? `最近 ${days} 天有消息` : "每天一格, 越深越忙"}>
      {!events ? <Skeleton className="h-[150px] w-full rounded-xl" /> : <HeatCalendar values={values} weeks={HEAT_WEEKS} color={TONE.success} unit="条" label="每天的消息数" className="w-full" />}
    </Section>
  );
}

type Slice = { key: string; label: string; value: number; color: string };

function slicesOf(events: Envelope[]): Slice[] {
  const by = new Map<string, number>();
  for (const e of events) {
    const g = groupOf(e) ?? e.source.name;
    by.set(g, (by.get(g) ?? 0) + 1);
  }
  const sorted = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, TOP_SOURCES).map(([g, v], i) => {
    const meta = chats.meta(g);
    return { key: g, label: meta ? titleOf(meta) : g, value: v, color: SOURCE_COLORS[i]! };
  });
  const rest = sorted.slice(TOP_SOURCES).reduce((n, [, v]) => n + v, 0);
  return rest ? [...top, { key: OTHER, label: OTHER, value: rest, color: SOURCE_COLORS[TOP_SOURCES]! }] : top;
}

// 消息来自哪里: 前几个群的占比 + 群 Agent 发出的比例仪表
export function Mix({ className }: { className?: string }) {
  const events = useActivity();
  const sids = useAgentSids();
  const slices = useMemo(() => (events ? slicesOf(events) : []), [events]);
  const total = events?.length ?? 0;
  const agentPct = total ? Math.round(((events ?? []).filter((e) => sids.has(e.source.id)).length * HUNDRED) / total) : 0;
  return (
    <Section title="消息来源" icon={<PieChart />} tone="warning" className={className} hint={total ? `最近 ${total} 条, 按群统计` : "按群统计"}>
      {!events ? (
        <Skeleton className="h-[220px] w-full rounded-xl" />
      ) : !total ? (
        <Quiet icon={<PieChart />}>还没有消息</Quiet>
      ) : (
        <>
          <div className="flex items-center justify-center">
            <Donut data={slices} size={DONUT_SIZE} centerLabel="条消息" />
          </div>
          <ul className="flex flex-col gap-1">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-xs">
                <span className="size-2 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
                <span className="num font-medium text-foreground">{s.value}</span>
                <span className="num w-9 text-right text-muted-foreground">{Math.round((s.value * HUNDRED) / total)}%</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex items-center gap-3 border-t border-border/60 pt-3">
            <Gauge value={agentPct} size={84} thickness={8} sweep={220} color={TONE.accent} format={(v) => `${Math.round(v)}%`} />
            <span className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">由 {CLOUD_AGENT_LABEL} 发出</span>
              <Fact value={sids.size} label="个 Agent 来源" color={TONE.accent} />
            </span>
          </div>
        </>
      )}
    </Section>
  );
}
