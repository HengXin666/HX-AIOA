import { CLOUD_AGENT_LABEL } from "../../core/constants";
import { ComboChart } from "@hx/ui/data";
import { Skeleton } from "@hx/ui/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { Activity } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useChats, useUser } from "../../app/hooks";
import { chats } from "../../core/chats";
import { buildPulse, lifetime, recentEvents, streakOf, type PulseSpan } from "../../core/pulse";
import type { Envelope } from "@hx-aioa/protocol";
import { Fact, Panel, Quiet, TONE } from "./parts";

const HUNDRED = 100;

// 你和 Agent 一起 (对照安卓 OverviewPulse, #140 #142): 线是我和 Agent 发的, 柱是完成的待办; 下面一排是事实数据
export function Pulse() {
  const { version } = useChats();
  const me = useUser();
  const [span, setSpan] = useState<PulseSpan>("day");
  const [events, setEvents] = useState<Envelope[] | null>(null);
  const head = chats.latest();
  // 进总览与连上时取一次; 之后新消息由会话库实时进来, 不再请求
  useEffect(() => {
    if (!head || events) return;
    void recentEvents(head).then(setEvents, () => setEvents([]));
  }, [head > 0]);
  const agentSids = useMemo(() => new Set(chats.ordered().flatMap((c) => (c.agents ?? []).map((a) => a.sourceId))), [version]);
  // 完成待办属于待办插件, 内置总览不画
  const doneAt: number[] = [];
  const uid = me?.id ?? "";
  const data = events && buildPulse(span, events, uid, agentSids, doneAt);
  const life = events && lifetime(events, uid, agentSids);
  const busiest = life ? Math.max(0, ...life.perDay.values()) : 0;

  return (
    <Panel
      title={`你和 ${CLOUD_AGENT_LABEL} 一起`}
      icon={<Activity />}
      tone={TONE.accent}
      className="lg:col-span-7"
      action={
        <ToggleGroup type="single" size="sm" variant="outline" value={span} onValueChange={(v) => v && setSpan(v as PulseSpan)}>
          <ToggleGroupItem value="day">今天</ToggleGroupItem>
          <ToggleGroupItem value="week">本周</ToggleGroupItem>
        </ToggleGroup>
      }
      hint={data?.peak ? `峰值 ${data.peak.label} · ${data.peak.count} 条` : undefined}
    >
      {!data ? (
        <Skeleton className="h-52 w-full" />
      ) : data.mine + data.agent + data.done === 0 ? (
        <Quiet>{span === "day" ? "今天还没有动静" : "这周还没有动静"}</Quiet>
      ) : (
        <ComboChart
          data={data.rows}
          x="label"
          bars={doneAt.length ? [{ key: "done", label: `完成待办 ${data.done}`, color: TONE.success }] : []}
          lines={[
            { key: "mine", label: `我 ${data.mine}`, color: TONE.primary },
            { key: "agent", label: `${CLOUD_AGENT_LABEL} ${data.agent}`, color: TONE.accent },
          ]}
          dualAxis={false}
          height={210}
        />
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border/70 px-2 pt-2">
        <Fact value={life ? streakOf(life.perDay) : "-"} label="天连续活跃" />
        <Fact value={life ? busiest : "-"} label="条最忙的一天" />
        <Fact value={life && life.total ? `${Math.round((life.agent * HUNDRED) / life.total)}%` : "-"} label={`由 ${CLOUD_AGENT_LABEL} 发出`} color={TONE.accent} />
      </div>
    </Panel>
  );
}
