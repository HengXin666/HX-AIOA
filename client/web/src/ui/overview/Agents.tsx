import { triggerView, type ChatAgent, type ChatMeta } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { Bot, ChevronRight } from "lucide-react";
import { useChats } from "../../app/hooks";
import { link, nav } from "../../app/router";
import { chats, titleOf } from "../../core/chats";
import { CLOUD_AGENT_LABEL } from "../../core/constants";
import { shortTime } from "../ChatList";
import { Panel, TONE } from "./parts";

const SHOWN = 8;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// 群 Agent: 一行一个, 只写能核对的事实 (状态, 下次运行, 上次运行), 不画进度环
export function Agents() {
  useChats();
  const list = chats.ordered().flatMap((m) => (m.agents ?? []).map((a) => [m, a] as const));
  if (!list.length) return null;
  const now = Date.now();
  const rows = list.map(([m, a]) => ({ m, a, s: statusOf(a, now) })).sort((x, y) => x.s.rank - y.s.rank);
  const late = rows.filter((r) => r.s.rank === 0).length;
  return (
    <Panel
      title={CLOUD_AGENT_LABEL}
      icon={<Bot />}
      tone="accent"
      count={list.length}
      hint={late ? `${late} 个超时未运行` : undefined}
      action={
        <Button asChild size="xs" variant="ghost">
          <a href={link("chat")}>
            消息
            <ChevronRight />
          </a>
        </Button>
      }
    >
      <div className="@container grid grid-cols-1 gap-x-4 @lg:grid-cols-2">
        {rows.slice(0, SHOWN).map(({ m, a, s }) => (
          <Row key={a.keyId} meta={m} a={a} s={s} />
        ))}
      </div>
      {list.length > SHOWN && <p className="px-2 pt-1 text-xs text-muted-foreground">另有 {list.length - SHOWN} 个, 在各自的群里</p>}
    </Panel>
  );
}

type Status = { text: string; color: string; rank: number };

function statusOf(a: ChatAgent, now: number): Status {
  const view = a.trigger ? triggerView(a.trigger, a.lastRun, now) : undefined;
  if (a.pending) return { text: "等它重新接入", color: TONE.warning, rank: 1 };
  if (view?.late) return { text: "超时未运行", color: TONE.danger, rank: 0 };
  if (view?.next) return { text: `${until(view.next - now)}后运行`, color: TONE.success, rank: 2 };
  return { text: "没上报触发方式", color: TONE.muted, rank: 3 };
}

function until(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} 分钟`;
  return `${Math.round(ms / HOUR)} 小时`;
}

function Row({ meta, a, s }: { meta: ChatMeta; a: ChatAgent; s: Status }) {
  return (
    <button type="button" onClick={() => nav("chat", meta.channel)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/70">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{a.name}</span>
          {a.plugin && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">插件</span>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{titleOf(meta)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end leading-tight">
        <span className="text-xs font-medium" style={{ color: s.color }}>
          {s.text}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{a.lastRun ? `上次 ${shortTime(a.lastRun)}` : "还没运行过"}</span>
      </span>
    </button>
  );
}
