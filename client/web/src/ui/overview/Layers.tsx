import type { OverviewItem, Priority, TaskSnapshot } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { BellRing, BookOpen, ChevronRight, Radio } from "lucide-react";
import type { ReactNode } from "react";
import { link, nav } from "../../app/router";
import { groupOf, textOf, type Message } from "../../core/chats";
import type { FeedSnapshot } from "../../core/feed";
import { TaskCard } from "../agent/TaskCard";
import { useAnswer } from "../agent/useAnswer";
import { shortTime } from "../ChatList";
import { Panel, Quiet } from "./parts";

// 三层 (对照安卓 OverviewPage.Layer): 需要我 (少而重要), 正在发生 (不必立即处理), 值得一看 (日报, 周报与摘要)
const LAYERS: Record<Priority, { title: string; hint: string; empty: string; icon: ReactNode; shown: number }> = {
  need_me: { title: "需要我", hint: "少而重要", empty: "一切正常, 没有需要处理的事", icon: <BellRing />, shown: 5 },
  happening: { title: "正在发生", hint: "不必立即处理", empty: "暂时风平浪静", icon: <Radio />, shown: 4 },
  worth_reading: { title: "值得一看", hint: "日报, 周报与摘要", empty: "今天没有新内容", icon: <BookOpen />, shown: 4 },
};

export function Layer({ snap, priority, className }: { snap: FeedSnapshot; priority: Priority; className?: string }) {
  const l = LAYERS[priority];
  const items = snap.layers[priority] ?? [];
  return (
    <Panel title={l.title} icon={l.icon} count={items.length} hint={l.hint} className={className}>
      {items.length ? items.slice(0, l.shown).map((it) => <Row key={it.ev.id} it={it} />) : <Quiet icon={l.icon}>{l.empty}</Quiet>}
    </Panel>
  );
}

// 需要我: 等我确认的任务直接给选项, 下面是需要我的事件
export function NeedMe({ snap, waiting, className }: { snap: FeedSnapshot; waiting: TaskSnapshot[]; className?: string }) {
  const [answer, dialog] = useAnswer();
  const l = LAYERS.need_me;
  const items = snap.layers.need_me ?? [];
  return (
    <Panel
      title={l.title}
      icon={l.icon}
      count={items.length + waiting.length}
      hint={l.hint}
      className={className}
      action={
        <Button asChild size="xs" variant="ghost">
          <a href={link("agent")}>
            Agent 栏
            <ChevronRight />
          </a>
        </Button>
      }
    >
      {waiting.map((t) => (
        <TaskCard key={t.id} task={t} pending={snap.pending[t.id]} onOption={(o) => answer(t, o)} />
      ))}
      {items.slice(0, l.shown).map((it) => (
        <Row key={it.ev.id} it={it} />
      ))}
      {!items.length && !waiting.length && <Quiet icon={l.icon}>{l.empty}</Quiet>}
      {dialog}
    </Panel>
  );
}

function Row({ it }: { it: OverviewItem }) {
  const ev = it.ev as Message;
  const g = it.ev.kind === "metric" ? null : groupOf(it.ev);
  const [title, ...rest] = (it.ev.kind === "metric" ? it.ev.source.name : textOf(ev)).split("\n");
  return (
    <Button variant="ghost" className="h-auto w-full justify-start gap-3 px-2 py-2 text-left whitespace-normal" disabled={!g} onClick={() => g && nav("chat", g, String(it.ev.seq))}>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium text-foreground">{title}</span>
        {rest.join(" ").trim() && <span className="line-clamp-1 text-xs font-normal text-muted-foreground">{rest.join(" ")}</span>}
        <span className="block text-xs font-normal text-muted-foreground">
          {it.ev.source.name} · {shortTime(it.ev.ts)}
        </span>
      </span>
      {it.count > 1 && <Badge variant="secondary">×{it.count}</Badge>}
    </Button>
  );
}
