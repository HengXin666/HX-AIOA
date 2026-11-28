import type { OverviewItem, Priority, TaskSnapshot } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { BellRing, BookOpen, Bot, ChevronRight, GitBranch, Mail, Radio, Server, X } from "lucide-react";
import type { ReactNode } from "react";
import { link, nav } from "../../app/router";
import { dismiss } from "../../core/attention";
import { groupOf, textOf, type Message } from "../../core/chats";
import type { FeedSnapshot } from "../../core/feed";
import { TaskCard } from "../agent/TaskCard";
import { useAnswer } from "../agent/useAnswer";
import { shortTime } from "../ChatList";
import { IconTile } from "../shell/nav";
import { Panel, Quiet, TONE } from "./parts";

// 三层 (对照安卓 OverviewPage.Layer): 需要我 (少而重要), 正在发生 (不必立即处理), 值得一看 (日报, 周报与摘要)
const LAYERS: Record<Priority, { title: string; hint: string; empty: string; icon: ReactNode; tone: string; shown: number }> = {
  need_me: { title: "需要我", hint: "看过或划掉就不再出现", empty: "没有要你处理的事", icon: <BellRing />, tone: TONE.danger, shown: 6 },
  happening: { title: "正在发生", hint: "近 24 小时", empty: "近 24 小时没有新动静", icon: <Radio />, tone: TONE.info, shown: 5 },
  worth_reading: { title: "值得一看", hint: "日报, 周报与摘要", empty: "这周没有新的摘要", icon: <BookOpen />, tone: TONE.accent, shown: 5 },
};

export function Layer({ snap, priority, className }: { snap: FeedSnapshot; priority: Priority; className?: string }) {
  const l = LAYERS[priority];
  const items = (snap.layers[priority] ?? []).filter((it) => it.ev.kind !== "task");
  return (
    <Panel title={l.title} icon={l.icon} tone={l.tone} count={items.length} hint={l.hint} className={className}>
      {items.length ? items.slice(0, l.shown).map((it) => <Row key={it.ev.id} it={it} />) : <Quiet>{l.empty}</Quiet>}
    </Panel>
  );
}

// 需要我: 等我确认的任务直接给选项, 下面是需要我的事件; 每行可划掉
export function NeedMe({ snap, items, waiting, className }: { snap: FeedSnapshot; items: OverviewItem[]; waiting: TaskSnapshot[]; className?: string }) {
  const [answer, dialog] = useAnswer();
  const l = LAYERS.need_me;
  return (
    <Panel
      id="need-me"
      title={l.title}
      icon={l.icon}
      tone={l.tone}
      count={items.length + waiting.length}
      hint={l.hint}
      className={className}
      action={
        items.length > 1 ? (
          <Button size="xs" variant="ghost" onClick={() => dismiss(items)}>
            全部划掉
          </Button>
        ) : (
          <Button asChild size="xs" variant="ghost">
            <a href={link("agent")}>
              Agent
              <ChevronRight />
            </a>
          </Button>
        )
      }
    >
      {waiting.map((t) => (
        <TaskCard key={t.id} task={t} pending={snap.pending[t.id]} onOption={(o) => answer(t, o)} />
      ))}
      {items.slice(0, l.shown).map((it) => (
        <Row key={it.ev.id} it={it} onDismiss={() => dismiss([it])} />
      ))}
      {items.length > l.shown && <p className="px-2 pt-1 text-xs text-muted-foreground">还有 {items.length - l.shown} 条, 划掉上面的会补上来</p>}
      {!items.length && !waiting.length && <Quiet>{l.empty}</Quiet>}
      {dialog}
    </Panel>
  );
}

const SOURCE_ICON: Record<string, [ReactNode, string]> = {
  agent: [<Bot />, TONE.accent],
  github: [<GitBranch />, TONE.muted],
  mail: [<Mail />, TONE.info],
  probe: [<Server />, TONE.warning],
};

function sourceIcon(it: OverviewItem): [ReactNode, string] {
  const s = it.ev.source;
  const key = Object.keys(SOURCE_ICON).find((k) => s.type === k || s.id.startsWith(k) || s.icon === k);
  return key ? SOURCE_ICON[key]! : [<Radio />, TONE.muted];
}

function Row({ it, onDismiss }: { it: OverviewItem; onDismiss?: () => void }) {
  const ev = it.ev as Message;
  const g = it.ev.kind === "metric" ? null : groupOf(it.ev);
  const [title, ...rest] = (it.ev.kind === "metric" ? it.ev.source.name : textOf(ev)).split("\n");
  const sub = rest.join(" ").trim();
  const [icon, tone] = sourceIcon(it);
  const open = () => {
    if (!g) return;
    onDismiss?.();
    nav("chat", g, String(it.ev.seq));
  };
  return (
    <div className="group relative flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/70">
      <IconTile tone={tone} size="sm">
        {icon}
      </IconTile>
      <button type="button" disabled={!g} onClick={open} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <span className="flex items-baseline gap-2">
          <span className="line-clamp-1 min-w-0 flex-1 text-[13px] font-medium text-foreground">{title || "(无标题)"}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{shortTime(it.ev.ts)}</span>
        </span>
        <span className="line-clamp-1 text-xs text-muted-foreground">
          {it.ev.source.name}
          {it.count > 1 && ` · 同类 ${it.count} 条`}
          {sub && ` · ${sub}`}
        </span>
      </button>
      {onDismiss && (
        <button type="button" aria-label="划掉" title="划掉" onClick={onDismiss} className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 [&_svg]:size-3.5">
          <X />
        </button>
      )}
    </div>
  );
}
