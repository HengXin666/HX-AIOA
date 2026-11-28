import { AgentProvider, Conversation, MessageList, TerminalOutput, terminalView, type AgentMessage, type ToolViewProps, type ToolViews } from "@hx/ui/agent";
import { Button } from "@hx/ui/ui/button";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hx/ui/ui/empty";
import { Spin } from "@hx/ui/ui/spin";
import { Circle, CircleCheck, CircleDot, MessageSquareDashed } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PAGE_TURNS } from "../../../agentgui/constants";
import { toMessages } from "../../../agentgui/toAgent";
import type { Tool } from "../../../agentgui/reduce";
import type { PlanEntry, SessionInfo } from "../../../agentgui/types";
import type { SessionSnap } from "../../../agentgui/session";
import { useGui } from "./ctx";

// 命令的完整输出只在展开时向探针要 (tool/output), 流里的片段先顶着
function LazyTerminal({ call }: ToolViewProps) {
  const { conn, sid } = useGui();
  const [full, setFull] = useState<string | null>(null);
  const running = call.status === "running";
  useEffect(() => {
    if (running) return;
    let live = true;
    conn
      .hx<{ content: unknown }>("tool/output", { sid, toolCallId: call.id })
      .then((r) => live && setFull(typeof r.content === "string" ? r.content : JSON.stringify(r.content, null, 2)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [conn, sid, call.id, running]);
  return <TerminalOutput command={String(call.args?.command ?? "")} output={full ?? call.output ?? ""} running={running} />;
}

const VIEWS: ToolViews = { bash: { ...terminalView, Body: LazyTerminal } };

// 时间线: HX-UI 的会话组件 (贴底跟随, 活动分组, 思考, 工具视图); 只渲染最近若干轮, 往上翻页
export function Timeline({ snap, info, footer, onRetry }: { snap: SessionSnap; info?: SessionInfo; footer: ReactNode; onRetry: () => void }) {
  const { conn, sid, insert, openRight } = useGui();
  const turns = snap.view.turns;
  const [shown, setShown] = useState(PAGE_TURNS);
  const start = Math.max(0, turns.length - shown);
  const canOlder = start > 0 || snap.more;
  const visible = useMemo(() => turns.slice(start), [turns, start]);
  const messages = useMemo(() => toMessages(visible, info?.cwd), [visible, info?.cwd]);

  const older = () => {
    if (start > 0) return setShown((n) => n + PAGE_TURNS);
    if (snap.loadingOlder) return;
    conn.older(sid).catch((e: Error) => toast.error(e.message));
    setShown((n) => n + PAGE_TURNS);
  };
  const actions = useMemo(
    () => ({
      onOpenFile: (path: string) => openRight("files", path),
      onOpenUrl: (url: string) => window.open(url, "_blank", "noopener"),
      onInspect: (call: { meta?: Record<string, unknown> }) => {
        const t = call.meta?.acp as Tool | undefined;
        if (t?.locations[0]) openRight("changes", t.locations[0].path);
      },
    }),
    [openRight],
  );
  const edit = (m: AgentMessage) => insert(m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n"));

  return (
    <AgentProvider toolViews={VIEWS} actions={actions} cwd={info?.cwd} planCalls="card">
      <Conversation className="min-h-0 flex-1" contentClassName="max-w-[768px] px-4" footer={footer}>
        {canOlder && (
          <Button variant="ghost" size="sm" className="mx-auto mb-4 flex" onClick={older} disabled={snap.loadingOlder}>
            {snap.loadingOlder ? "加载中" : "加载更早的对话"}
          </Button>
        )}
        {!snap.loaded && turns.length === 0 ? (
          <Spin className="mx-auto mt-16" />
        ) : (
          <MessageList
            messages={messages}
            onEdit={edit}
            onRetry={onRetry}
            empty={
              <Empty size="compact" animate="rise" className="mt-24">
                <EmptyMedia variant="icon">
                  <MessageSquareDashed />
                </EmptyMedia>
                <EmptyTitle>还没有消息</EmptyTitle>
                <EmptyDescription>在下面说点什么, / 看命令, @ 引用文件</EmptyDescription>
              </Empty>
            }
          />
        )}
      </Conversation>
    </AgentProvider>
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
