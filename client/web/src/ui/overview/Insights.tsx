import type { Envelope } from "@hx-aioa/protocol";
import { Skeleton } from "@hx/ui/ui/skeleton";
import { m } from "motion/react";
import { Inbox } from "lucide-react";
import { useMemo } from "react";
import { nav } from "../../app/router";
import { chats, groupOf, titleOf } from "../../core/chats";
import { useActivity } from "../shell/activity";
import { Quiet, Section, seriesOf } from "./parts";

const TOP = 8;
const HUNDRED = 100;

type Row = { key: string; label: string; value: number; chat: boolean };

function rowsOf(events: Envelope[]): Row[] {
  const by = new Map<string, number>();
  for (const e of events) {
    const g = groupOf(e) ?? e.source.name;
    by.set(g, (by.get(g) ?? 0) + 1);
  }
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([g, v]) => {
      const meta = chats.meta(g);
      return { key: g, label: meta ? titleOf(meta) : g, value: v, chat: Boolean(meta) };
    });
}

// 消息来源: 最近的消息按群排, 条形长度是占比; 点一行进那个群
export function Sources({ className }: { className?: string }) {
  const events = useActivity();
  const rows = useMemo(() => (events ? rowsOf(events) : []), [events]);
  const total = events?.length ?? 0;
  const max = rows[0]?.value ?? 1;
  return (
    <Section title="消息来源" icon={<Inbox />} tone="teal" className={className} hint={total ? `最近 ${total} 条, 按群统计` : "按群统计"}>
      {!events ? (
        <Skeleton className="h-[220px] w-full rounded-lg" />
      ) : !rows.length ? (
        <Quiet icon={<Inbox />}>还没有消息</Quiet>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {rows.map((r, i) => (
            <li key={r.key}>
              <button
                type="button"
                disabled={!r.chat}
                onClick={() => nav("chat", r.key)}
                className="flex w-full flex-col gap-1.5 rounded-md px-2 py-2 text-left text-sm transition-colors enabled:hover:bg-muted/60"
              >
                <span className="flex w-full items-baseline gap-2">
                  <span aria-hidden className="size-2 shrink-0 self-center rounded-sm" style={{ background: seriesOf(i) }} />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="tabular-nums">{r.value}</span>
                  <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{Math.round((r.value * HUNDRED) / total)}%</span>
                </span>
                <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <m.span
                    className="block h-full origin-left rounded-full"
                    style={{ width: `${(r.value * HUNDRED) / max}%`, background: seriesOf(i) }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ delay: 0.1 + i * 0.04, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
