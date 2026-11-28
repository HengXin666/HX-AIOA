import { AreaTrend, HeatCalendar } from "@hx/ui/data";
import { Chip, ChipGroup } from "@hx/ui/ui/chip-group";
import { Skeleton } from "@hx/ui/ui/skeleton";
import { Activity } from "lucide-react";
import { useMemo, useState } from "react";
import { useChats, useUser } from "../../app/hooks";
import { chats } from "../../core/chats";
import { CLOUD_AGENT_LABEL } from "../../core/constants";
import { buildPulse, lifetime, streakOf, type PulseSpan } from "../../core/pulse";
import { useActivity } from "../shell/activity";
import { Feat, Quiet, Section, TONE } from "./parts";

const HUNDRED = 100;
const CHART_H = 220;
const HEAT_WEEKS = 26;
const SPANS: { id: PulseSpan; label: string }[] = [
  { id: "day", label: "今天" },
  { id: "week", label: "本周" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// 群 Agent 的来源 id: 判断一条消息是不是 Agent 发的
export function useAgentSids(): Set<string> {
  const { version } = useChats();
  return useMemo(() => new Set(chats.ordered().flatMap((c) => (c.agents ?? []).map((a) => a.sourceId))), [version]);
}

// 活跃 (对照安卓 OverviewPulse, #140 #142): 上面是我和群 Agent 发的 (按小时 / 按天), 中间几项事实, 下面是每天一格的活跃日历。
// 完成待办属于待办插件, 内置总览不画。
export function Pulse({ className }: { className?: string }) {
  const me = useUser();
  const events = useActivity();
  const agentSids = useAgentSids();
  const [span, setSpan] = useState<PulseSpan>("day");
  const uid = me?.id ?? "";
  const data = useMemo(() => events && buildPulse(span, events, uid, agentSids, []), [events, span, uid, agentSids]);
  const life = useMemo(() => events && lifetime(events, uid, agentSids), [events, uid, agentSids]);
  const heat = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of events ?? []) out[isoDay(e.ts)] = (out[isoDay(e.ts)] ?? 0) + 1;
    return out;
  }, [events]);
  const busiest = life ? Math.max(0, ...life.perDay.values()) : null;

  return (
    <Section
      title="活跃"
      icon={<Activity />}
      tone="primary"
      className={className}
      hint={`我和${CLOUD_AGENT_LABEL}发出的消息${data?.peak ? `, 峰值 ${data.peak.label} 有 ${data.peak.count} 条` : ""}`}
      action={
        <ChipGroup type="single" size="sm" variant="soft" value={span} onValueChange={(v) => v && setSpan(v as PulseSpan)}>
          {SPANS.map((s) => (
            <Chip key={s.id} value={s.id}>
              {s.label}
            </Chip>
          ))}
        </ChipGroup>
      }
    >
      {!data ? (
        <Skeleton className="w-full rounded-lg" style={{ height: CHART_H }} />
      ) : data.mine + data.agent === 0 ? (
        <div className="flex" style={{ height: CHART_H }}>
          <Quiet icon={<Activity />}>{span === "day" ? "今天还没有消息" : "这周还没有消息"}</Quiet>
        </div>
      ) : (
        <AreaTrend
          key={span}
          data={data.rows}
          x="label"
          series={[
            { key: "mine", label: `我 ${data.mine}`, color: TONE.primary },
            { key: "agent", label: `${CLOUD_AGENT_LABEL} ${data.agent}`, color: TONE.amber },
          ]}
          stacked
          height={CHART_H}
        />
      )}
      <div className="grid grid-cols-4 gap-4 border-y py-3">
        <Feat value={life ? streakOf(life.perDay) : null} label="天连续活跃" color={TONE.green} />
        <Feat value={busiest} label="条最忙一天" color={TONE.teal} />
        <Feat value={life?.total ?? null} label="条最近消息" color={TONE.primary} />
        <Feat value={life ? (life.total ? Math.round((life.agent * HUNDRED) / life.total) : 0) : null} label={`% 由${CLOUD_AGENT_LABEL}发出`} color={TONE.amber} />
      </div>
      {events ? <HeatCalendar values={heat} weeks={HEAT_WEEKS} unit="条" label="每天的消息数" color={TONE.primary} className="w-full" /> : <Skeleton className="h-[120px] w-full rounded-lg" />}
    </Section>
  );
}
