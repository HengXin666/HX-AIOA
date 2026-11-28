import { AreaTrend } from "@hx/ui/data";
import { LiveDot } from "@hx/ui/effects/live-dot";
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
const CHART_H = 236;
const SPANS: { id: PulseSpan; label: string }[] = [
  { id: "day", label: "今天" },
  { id: "week", label: "本周" },
];

// 群 Agent 的来源 id: 判断一条消息是不是 Agent 发的
export function useAgentSids(): Set<string> {
  const { version } = useChats();
  return useMemo(() => new Set(chats.ordered().flatMap((c) => (c.agents ?? []).map((a) => a.sourceId))), [version]);
}

// 你和 Agent 一起 (对照安卓 OverviewPulse, #140 #142): 面积图是我和 Agent 发的 (按小时 / 按天), 下面一排是本机能算出的事实数据。
// 完成待办属于待办插件, 内置总览不画。
export function Pulse({ className }: { className?: string }) {
  const me = useUser();
  const events = useActivity();
  const agentSids = useAgentSids();
  const [span, setSpan] = useState<PulseSpan>("day");
  const uid = me?.id ?? "";
  const data = useMemo(() => events && buildPulse(span, events, uid, agentSids, []), [events, span, uid, agentSids]);
  const life = useMemo(() => events && lifetime(events, uid, agentSids), [events, uid, agentSids]);
  const busiest = life ? Math.max(0, ...life.perDay.values()) : null;

  return (
    <Section
      title={`你和 ${CLOUD_AGENT_LABEL} 一起`}
      icon={<Activity />}
      tone="accent"
      className={className}
      hint={
        <span className="inline-flex items-center gap-1.5">
          <LiveDot tone="success" live />
          实时{data?.peak ? ` · 峰值 ${data.peak.label}, ${data.peak.count} 条` : ""}
        </span>
      }
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
        <Skeleton className="w-full rounded-xl" style={{ height: CHART_H }} />
      ) : data.mine + data.agent === 0 ? (
        <div style={{ height: CHART_H }} className="flex">
          <Quiet icon={<Activity />}>{span === "day" ? "今天还没有动静" : "这周还没有动静"}</Quiet>
        </div>
      ) : (
        <AreaTrend
          key={span}
          data={data.rows}
          x="label"
          series={[
            { key: "mine", label: `我 ${data.mine}`, color: TONE.primary },
            { key: "agent", label: `${CLOUD_AGENT_LABEL} ${data.agent}`, color: TONE.accent },
          ]}
          stacked
          height={CHART_H}
        />
      )}
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Feat value={life ? streakOf(life.perDay) : null} label="天连续活跃" color={TONE.warning} />
        <Feat value={busiest} label="条最忙一天" color={TONE.primary} />
        <Feat value={life?.total ?? null} label="条近期消息" color={TONE.success} />
        <Feat value={life ? (life.total ? Math.round((life.agent * HUNDRED) / life.total) : 0) : null} label={`% 由 ${CLOUD_AGENT_LABEL} 发出`} color={TONE.accent} />
      </div>
    </Section>
  );
}
