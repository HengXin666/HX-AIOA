import { CLOUD_AGENT_LABEL } from "../../core/constants";
import { ComboChart } from "@hx/ui/data";
import { Badge } from "@hx/ui/ui/badge";
import { Skeleton } from "@hx/ui/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { Activity } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useChats, useUser } from "../../app/hooks";
import { chats } from "../../core/chats";
import { buildPulse, lifetime, recentEvents, streakOf, type PulseSpan } from "../../core/pulse";
import type { Envelope } from "@hx-aioa/protocol";
import { useTodos } from "../todo/TodoBoard";
import { Feat, Panel, Quiet, TONE } from "./parts";

const HUNDRED = 100;

// 你和 Agent 一起 (对照安卓 OverviewPulse, #140 #142): 线是我和 Agent 发的, 柱是完成的待办; 下面一排是事实数据
export function Pulse({ needMe }: { needMe: number }) {
  const { version } = useChats();
  const me = useUser();
  const todos = useTodos();
  const [span, setSpan] = useState<PulseSpan>("day");
  const [events, setEvents] = useState<Envelope[] | null>(null);
  const head = chats.latest();
  // 进总览与连上时取一次; 之后新消息由会话库实时进来, 不再请求
  useEffect(() => {
    if (!head || events) return;
    void recentEvents(head).then(setEvents, () => setEvents([]));
  }, [head > 0]);
  const agentSids = useMemo(() => new Set(chats.ordered().flatMap((c) => (c.agents ?? []).map((a) => a.sourceId))), [version]);
  const doneAt = todos.flatMap((t) => (t.state === "done" && t.doneAt ? [t.doneAt] : []));
  const uid = me?.id ?? "";
  const data = events && buildPulse(span, events, uid, agentSids, doneAt);
  const life = events && lifetime(events, uid, agentSids);
  const busiest = life ? Math.max(0, ...life.perDay.values()) : 0;

  return (
    <Panel
      title={`你和 ${CLOUD_AGENT_LABEL} 一起`}
      icon={<Activity />}
      className="lg:col-span-8"
      action={
        <ToggleGroup type="single" size="sm" variant="outline" value={span} onValueChange={(v) => v && setSpan(v as PulseSpan)}>
          <ToggleGroupItem value="day">今天</ToggleGroupItem>
          <ToggleGroupItem value="week">本周</ToggleGroupItem>
        </ToggleGroup>
      }
      hint={
        data?.peak ? (
          <span className="flex items-center gap-2">
            <Badge variant="outline" dot="success" live>
              实时
            </Badge>
            峰值 {data.peak.label} · {data.peak.count} 条
          </span>
        ) : undefined
      }
    >
      {!data ? (
        <Skeleton className="h-52 w-full" />
      ) : data.mine + data.agent + data.done === 0 ? (
        <Quiet icon={<Activity />}>{span === "day" ? "今天还没有动静" : "这周还没有动静"}</Quiet>
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Feat value={life ? streakOf(life.perDay) : "-"} label="天连续活跃" color={TONE.warning} />
        <Feat value={life ? busiest : "-"} label="条最忙一天" color={TONE.primary} />
        <Feat value={life && life.total ? Math.round((life.agent * HUNDRED) / life.total) : 0} label={`% 是 ${CLOUD_AGENT_LABEL}`} color={TONE.accent} />
        <Feat value={needMe} label="条等你" color={needMe > 0 ? TONE.danger : TONE.muted} />
      </div>
    </Panel>
  );
}
