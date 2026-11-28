import { triggerView, type ChatAgent, type ChatMeta } from "@hx-aioa/protocol";
import { Gauge } from "@hx/ui/data";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Card } from "@hx/ui/ui/card";
import { Bot, ChevronRight } from "lucide-react";
import { useChats } from "../../app/hooks";
import { link, nav } from "../../app/router";
import { chats, titleOf } from "../../core/chats";
import { CLOUD_AGENT_LABEL } from "../../core/constants";
import { Panel, TONE } from "./parts";

const SHOWN = 8;
const MINUTE = 60_000;
const TONES = [TONE.primary, TONE.warning, TONE.accent, TONE.success];

// 群 Agent (对照安卓 OverviewV2.AgentTile): 环是 "从上次运行到下次触发" 走了多少; 逾期标红, 没上报触发方式时只显示名字
export function Agents() {
  useChats();
  const list = chats.ordered().flatMap((m) => (m.agents ?? []).map((a) => [m, a] as const));
  if (!list.length) return null;
  return (
    <Panel
      title={CLOUD_AGENT_LABEL}
      icon={<Bot />}
      count={list.length}
      className="lg:col-span-12"
      action={
        <Button asChild size="xs" variant="ghost">
          <a href={link("chat")}>
            消息
            <ChevronRight />
          </a>
        </Button>
      }
    >
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
        {list.slice(0, SHOWN).map(([m, a], i) => (
          <Tile key={a.keyId} meta={m} a={a} tone={TONES[i % TONES.length]!} />
        ))}
      </div>
    </Panel>
  );
}

function Tile({ meta, a, tone }: { meta: ChatMeta; a: ChatAgent; tone: string }) {
  const now = Date.now();
  const view = a.trigger ? triggerView(a.trigger, a.lastRun, now) : undefined;
  const next = view?.next;
  const last = a.lastRun;
  const f = next && last && next > last ? Math.min(1, Math.max(0, (now - last) / (next - last))) : 0;
  const [text, color] = a.pending
    ? ["等它重新接入", TONE.warning]
    : view?.late
      ? ["超时未运行", TONE.danger]
      : next
        ? [`约 ${Math.max(1, Math.round((next - now) / MINUTE))} 分钟后运行`, tone]
        : ["没上报触发方式", TONE.muted];
  return (
    <Card className="cursor-pointer gap-2 p-3 shadow-none transition-colors hover:border-ring/50" onClick={() => nav("chat", meta.channel)}>
      <div className="flex items-start justify-between">
        <Gauge value={Math.round(f * 100)} max={100} size={76} thickness={22} sweep={300} color={color} className="mx-0" format={(v) => (next ? `${Math.round(v)}%` : "-")}/>
        {a.plugin && <Badge variant="secondary">插件</Badge>}
      </div>
      <p className="truncate text-sm font-semibold text-foreground">{a.name}</p>
      <p className="truncate text-xs text-muted-foreground">{titleOf(meta)}</p>
      <p className="text-xs font-medium" style={{ color }}>
        {text}
      </p>
    </Card>
  );
}
