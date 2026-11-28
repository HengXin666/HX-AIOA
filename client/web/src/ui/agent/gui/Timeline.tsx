import { Alert, AlertAction, AlertDescription, AlertTitle } from "@hx/ui/ui/alert";
import { Button } from "@hx/ui/ui/button";
import { Spin } from "@hx/ui/ui/spin";
import { Brain, ChevronRight, CircleCheck, Circle, CircleDot } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PAGE_TURNS } from "../../../agentgui/constants";
import { mergeTools, segments, type Item, type Tool, type Turn } from "../../../agentgui/reduce";
import type { PlanEntry } from "../../../agentgui/types";
import type { SessionSnap } from "../../../agentgui/session";
import { useGui } from "./ctx";
import { Md } from "./Md";
import { duration, kTok } from "./parts";
import { ToolRowView } from "./ToolRow";

// 时间线: 只渲染最近若干轮, 往上滚到顶再往前翻 (本地没有了才向探针按轮要)
export function Timeline({ snap, onRetry, onModel }: { snap: SessionSnap; onRetry: () => void; onModel: () => void }) {
  const { conn, sid } = useGui();
  const turns = snap.view.turns;
  const [shown, setShown] = useState(PAGE_TURNS);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const start = Math.max(0, turns.length - shown);
  const canOlder = start > 0 || snap.more;

  const older = () => {
    const el = box.current;
    prevHeight.current = el ? el.scrollHeight - el.scrollTop : 0;
    if (start > 0) return setShown((n) => n + PAGE_TURNS);
    if (snap.loadingOlder) return;
    conn.older(sid).catch((e: Error) => toast.error(e.message));
    setShown((n) => n + PAGE_TURNS);
  };

  // 跟住底部: 用户往上翻了就不再自动滚
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (prevHeight.current) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      prevHeight.current = 0;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [snap.version, shown]);

  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = top.current;
    if (!el || !canOlder) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && box.current && box.current.scrollTop > 0 && older(), { root: box.current });
    io.observe(el);
    return () => io.disconnect();
  });

  return (
    <div
      ref={box}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      <div className="mx-auto flex w-full max-w-[768px] flex-col gap-6 px-4 py-6">
        <div ref={top} />
        {canOlder && (
          <Button variant="ghost" size="sm" className="self-center" onClick={older} disabled={snap.loadingOlder}>
            {snap.loadingOlder ? "加载中" : "加载更早的对话"}
          </Button>
        )}
        {!snap.loaded && turns.length === 0 && <Spin className="self-center" />}
        {snap.loaded && turns.length === 0 && <p className="text-center text-sm text-muted-foreground">还没有消息, 在下面说点什么</p>}
        {turns.slice(start).map((t, i) => (
          <TurnView key={t.key} turn={t} last={start + i === turns.length - 1} onRetry={onRetry} onModel={onModel} />
        ))}
      </div>
    </div>
  );
}

const TurnView = memo(function TurnView({ turn, last, onRetry, onModel }: { turn: Turn; last: boolean; onRetry: () => void; onModel: () => void }) {
  const userText = (turn.user ?? []).map((b) => b.text ?? (b.uri ? `[${b.name ?? b.uri}]` : "")).join("\n");
  const segs = segments(turn.items);
  return (
    <section className="flex flex-col gap-3" aria-label="一轮对话">
      {turn.user && (
        <div className={`self-end rounded-2xl bg-muted px-4 py-2 text-[15px] leading-7 whitespace-pre-wrap text-foreground max-w-[85%] ${turn.local ? "opacity-70" : ""}`}>{userText}</div>
      )}
      {segs.map((s, i) =>
        s.t === "group" ? (
          <WorkGroup key={s.key} items={s.items} live={turn.running && i === segs.length - 1} />
        ) : (
          <ItemView key={s.item.key} item={s.item} onRetry={last ? onRetry : undefined} onModel={onModel} />
        ),
      )}
      {turn.running && segs.length === 0 && <Spin size="sm" />}
      <TurnFoot turn={turn} />
    </section>
  );
});

function TurnFoot({ turn }: { turn: Turn }) {
  if (turn.running) return null;
  const bits: string[] = [];
  if (turn.start && turn.end && turn.end > turn.start) bits.push(duration(turn.end - turn.start));
  const u = turn.usage;
  if (u?.input !== undefined || u?.output !== undefined) bits.push(`输入 ${kTok(u.input ?? 0)} / 输出 ${kTok(u.output ?? 0)}`);
  if (u?.cacheRead !== undefined && u.input) bits.push(`缓存 ${Math.round((u.cacheRead / (u.input + u.cacheRead + (u.cacheWrite ?? 0))) * 100)}%`);
  if (turn.stop && turn.stop !== "end_turn") bits.push(turn.stop === "cancelled" ? "已停止" : turn.stop);
  if (bits.length === 0) return null;
  return <p className="text-xs text-muted-foreground tabular-nums">{bits.join(" · ")}</p>;
}

function ItemView({ item, onRetry, onModel }: { item: Item; onRetry?: () => void; onModel: () => void }) {
  switch (item.t) {
    case "msg":
      return <Md text={item.text} />;
    case "plan":
      return <PlanList entries={item.entries} />;
    case "error":
      return <ErrorBar item={item} onRetry={onRetry} onModel={onModel} />;
    case "note":
      return <p className="text-xs text-muted-foreground">{item.text}</p>;
    case "thought":
      return <Thought text={item.text} ms={(item.end ?? 0) - (item.start ?? 0)} />;
    case "tool":
      return <ToolRowView row={{ key: item.key, kind: item.tool.kind, tools: [item.tool] }} />;
  }
}

function summary(items: Item[]): string {
  const tools = items.flatMap((i) => (i.t === "tool" ? [i.tool] : []));
  const files = (kind: string) => new Set(tools.filter((t) => t.kind === kind).map((t) => t.locations[0]?.path ?? t.id)).size;
  const count = (kind: string) => tools.filter((t) => t.kind === kind).length;
  const bits: string[] = [];
  if (files("read")) bits.push(`读 ${files("read")} 个文件`);
  if (files("edit")) bits.push(`改 ${files("edit")} 个`);
  if (count("delete")) bits.push(`删 ${count("delete")} 个`);
  if (count("execute")) bits.push(`运行 ${count("execute")} 条命令`);
  if (count("search")) bits.push(`搜索 ${count("search")} 次`);
  if (count("fetch")) bits.push(`联网 ${count("fetch")} 次`);
  const other = tools.length - ["read", "edit", "delete", "execute", "search", "fetch"].reduce((n, k) => n + count(k), 0);
  if (other > 0) bits.push(`其它 ${other} 个`);
  const thoughts = items.filter((i) => i.t === "thought").length;
  if (thoughts && bits.length === 0) bits.push("思考");
  const starts = tools.map((t) => t.start ?? 0).filter(Boolean);
  const ends = tools.map((t) => t.end ?? 0).filter(Boolean);
  if (starts.length && ends.length) {
    const ms = Math.max(...ends) - Math.min(...starts);
    if (ms > 1000) bits.push(duration(ms));
  }
  return bits.join(" · ");
}

// 一轮里连续的工具与思考折叠成一行; 运行中展开并露出最新一项
function WorkGroup({ items, live }: { items: Item[]; live: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? live;
  const tools = items.filter((i) => i.t === "tool").length;
  if (tools <= 1 && items.length <= 2 && !live) return <GroupBody items={items} />;
  return (
    <div className="rounded-xl border border-border">
      <button type="button" onClick={() => setOpen(!expanded)} aria-expanded={expanded} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted [&_svg]:size-4">
        <ChevronRight className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        <span className="min-w-0 flex-1 truncate">{summary(items) || "工作中"}</span>
        {live && <Spin size="sm" />}
      </button>
      {expanded && (
        <div className="border-t border-border px-1 py-1">
          <GroupBody items={items} />
        </div>
      )}
    </div>
  );
}

function GroupBody({ items }: { items: Item[] }) {
  const out: React.ReactNode[] = [];
  let run: Tool[] = [];
  const flush = () => {
    for (const row of mergeTools(run)) out.push(<ToolRowView key={row.key} row={row} />);
    run = [];
  };
  for (const it of items) {
    if (it.t === "tool") run.push(it.tool);
    else {
      flush();
      if (it.t === "thought") out.push(<Thought key={it.key} text={it.text} ms={(it.end ?? 0) - (it.start ?? 0)} />);
    }
  }
  flush();
  return <div className="flex flex-col">{out}</div>;
}

function Thought({ text, ms }: { text: string; ms: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted [&_svg]:size-4">
        <Brain />
        {ms >= 1000 ? `思考了 ${duration(ms)}` : "思考"}
        <ChevronRight className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <p className="ml-8 border-l-2 border-border pl-3 text-sm whitespace-pre-wrap text-muted-foreground">{text}</p>}
    </div>
  );
}

export function PlanList({ entries }: { entries: PlanEntry[] }) {
  const done = entries.filter((e) => e.status === "completed").length;
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        计划 {done}/{entries.length}
      </p>
      <ul className="flex flex-col gap-1.5">
        {entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
            {e.status === "completed" ? <CircleCheck className="text-success" /> : e.status === "in_progress" ? <CircleDot className="text-info" /> : <Circle className="text-muted-foreground" />}
            <span className={e.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}>{e.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const USAGE_LIMIT = "usage_limit";

function ErrorBar({ item, onRetry, onModel }: { item: Extract<Item, { t: "error" }>; onRetry?: () => void; onModel: () => void }) {
  const data = (item.data ?? {}) as { kind?: string; reason?: string; resetAt?: number | string };
  const limit = data.kind === USAGE_LIMIT || data.reason === USAGE_LIMIT || /usage.?limit|额度/i.test(item.msg);
  const reset = data.resetAt ? new Date(typeof data.resetAt === "number" && data.resetAt < 1e12 ? data.resetAt * 1000 : data.resetAt).toLocaleString() : "";
  return (
    <Alert variant="destructive">
      <AlertTitle>{limit ? "额度用尽" : "出错了"}</AlertTitle>
      <AlertDescription>
        <span className="break-words whitespace-pre-wrap">{item.msg}</span>
        {reset && <span className="block">重置时间: {reset}</span>}
      </AlertDescription>
      <AlertAction>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            重试
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onModel}>
          换模型
        </Button>
      </AlertAction>
    </Alert>
  );
}
