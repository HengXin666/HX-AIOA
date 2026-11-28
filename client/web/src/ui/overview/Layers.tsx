import type { OverviewItem, Priority, TaskSnapshot } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle, ItemTrigger } from "@hx/ui/ui/item";
import { AnimatePresence, m } from "motion/react";
import { AlertTriangle, Bell, BellRing, BookOpen, CheckCheck, ChevronDown, ChevronRight, Copy, Mail, Radio, Sun, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useFeed } from "../../app/hooks";
import { link } from "../../app/router";
import { pending } from "../../core/attention";
import { seen, useSeen } from "../../core/seen";
import { TaskCard } from "../agent/TaskCard";
import { useAnswer } from "../agent/useAnswer";
import { shortTime } from "../ChatList";
import { EventSheet } from "./EventSheet";
import { rowOf, type Row } from "./items";
import { Quiet, Section, TONE, tint, type Tone } from "./parts";

// 三层 (对照安卓 OverviewPage.Layer): 点开看过或点 x 划掉的不再占位置, 新来的照常出现; 验证码可直接复制
type LayerSpec = { title: string; hint: string; empty: string; icon: ReactNode; tone: Tone; shown: number };
export const LAYERS: Record<Priority, LayerSpec> = {
  need_me: { title: "需要我", hint: "少而重要", empty: "一切正常, 没有需要处理的事", icon: <BellRing />, tone: "danger", shown: 5 },
  happening: { title: "正在发生", hint: "不必立即处理", empty: "暂时风平浪静", icon: <Radio />, tone: "primary", shown: 4 },
  worth_reading: { title: "值得一看", hint: "日报, 周报与摘要", empty: "今天没有新内容", icon: <BookOpen />, tone: "accent", shown: 4 },
};
const KIND_ICON = { alert: <AlertTriangle />, report: <Sun />, mail: <Mail />, bell: <Bell /> } as const;
const CODE_TICK_MS = 30_000;

// 与顶部计数同一套过滤 (core/attention.pending), 列表和数字不会对不上
export function visibleRows(items: OverviewItem[] | undefined, now: number): Row[] {
  return pending(items).map((it) => rowOf(it, now));
}

// 验证码剩余时间: 有验证码时每半分钟重算一次
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), CODE_TICK_MS);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function Layer({ priority, className }: { priority: Priority; className?: string }) {
  const snap = useFeed();
  useSeen();
  const l = LAYERS[priority];
  const items = snap.layers[priority];
  const now = useNow(Boolean(items?.some((it) => (it.ev as { data?: { mail?: unknown } }).data?.mail)));
  const rows = visibleRows(items, now);
  return (
    <Section title={l.title} icon={l.icon} tone={l.tone} count={rows.length} hint={l.hint} className={className} action={<ClearAll rows={rows} />}>
      <Rows rows={rows} shown={l.shown} empty={<Quiet icon={l.icon}>{l.empty}</Quiet>} />
    </Section>
  );
}

// 需要我: 等我确认的任务直接给选项, 下面是需要我的事件
export function NeedMe({ waiting, className }: { waiting: TaskSnapshot[]; className?: string }) {
  const snap = useFeed();
  useSeen();
  const [answer, dialog] = useAnswer();
  const l = LAYERS.need_me;
  const items = snap.layers.need_me;
  const now = useNow(Boolean(items?.length));
  const rows = visibleRows(items, now);
  const total = rows.length + waiting.length;
  return (
    <Section
      title={l.title}
      icon={l.icon}
      tone={total ? "danger" : "success"}
      count={total}
      hint={l.hint}
      className={className}
      action={
        rows.length ? (
          <ClearAll rows={rows} />
        ) : (
          <Button asChild size="xs" variant="ghost">
            <a href={link("agent")}>
              Agent 栏
              <ChevronRight />
            </a>
          </Button>
        )
      }
    >
      <AnimatePresence initial={false}>
        {waiting.map((t) => (
          <m.div key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
            <TaskCard task={t} pending={snap.pending[t.id]} onOption={(o) => answer(t, o)} />
          </m.div>
        ))}
      </AnimatePresence>
      <Rows rows={rows} shown={l.shown} empty={waiting.length ? null : <Quiet icon={<CheckCheck />} tone="success">{l.empty}</Quiet>} />
      {dialog}
    </Section>
  );
}

function ClearAll({ rows }: { rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <Button size="xs" variant="ghost" onClick={() => seen.mark(rows.flatMap((r) => r.ids))}>
      <CheckCheck />
      全部已读
    </Button>
  );
}

function Rows({ rows, shown, empty }: { rows: Row[]; shown: number; empty: ReactNode }) {
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<Row | null>(null);
  if (!rows.length) return <>{empty}</>;
  const list = more ? rows : rows.slice(0, shown);
  return (
    <>
      <ItemGroup size="default" highlight="slide" roving className="-mx-2">
        <AnimatePresence initial={false}>
          {list.map((r) => (
            <m.div key={r.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24, height: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
              <LayerRow r={r} onOpen={() => setOpen(r)} />
            </m.div>
          ))}
        </AnimatePresence>
      </ItemGroup>
      {rows.length > shown && (
        <Button size="sm" variant="ghost" className="self-start text-muted-foreground" onClick={() => setMore(!more)}>
          <ChevronDown className={more ? "rotate-180 transition-transform" : "transition-transform"} />
          {more ? "收起" : `还有 ${rows.length - shown} 条`}
        </Button>
      )}
      <EventSheet row={open} onClose={() => setOpen(null)} />
    </>
  );
}

function LayerRow({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const color = TONE[r.tone];
  const copy = () => r.code && void navigator.clipboard.writeText(r.code).then(() => toast.success(`已复制验证码 ${r.code}`));
  return (
    <Item className="items-start">
      <ItemMedia variant="icon" className="mt-0.5 rounded-lg [&_svg]:size-4" style={{ background: tint(color), color }}>
        {KIND_ICON[r.kind]}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <ItemTrigger
            onClick={() => {
              seen.mark(r.ids);
              onOpen();
            }}
          >
            {r.title}
          </ItemTrigger>
          {r.count > 1 && <Badge variant="secondary">同类 {r.count} 条</Badge>}
        </ItemTitle>
        {r.code ? (
          <span className="flex items-baseline gap-2">
            <span className={`font-mono text-lg font-semibold tracking-[0.2em] ${r.codeExpired ? "text-muted-foreground line-through" : "text-foreground"}`}>{r.code}</span>
            {r.codeNote && <span className={`text-xs ${r.codeExpired ? "text-muted-foreground" : "text-warning"}`}>{r.codeNote}</span>}
          </span>
        ) : (
          r.summary && <ItemDescription lines={2}>{r.summary}</ItemDescription>
        )}
        <span className="text-xs text-muted-foreground">
          {r.source} · {shortTime(r.ts)}
        </span>
      </ItemContent>
      <ItemActions reveal="hover">
        {r.code && !r.codeExpired && (
          <Button size="icon-xs" variant="ghost" aria-label="复制验证码" onClick={copy}>
            <Copy />
          </Button>
        )}
        <Button size="icon-xs" variant="ghost" aria-label="划掉" onClick={() => seen.mark(r.ids)}>
          <X />
        </Button>
      </ItemActions>
    </Item>
  );
}
