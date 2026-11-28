import type { PromptOption, TaskSnapshot } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Code } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useInbox } from "../../agentgui/hooks";
import { useFeed, useLinkState, useUser } from "../../app/hooks";
import { TXT_LOADING } from "../../core/constants";
import { feed } from "../../core/feed";
import { EmptyState, PageHeader } from "../kit/Panes";
import type { AreaProps } from "../Shell";
import { HxoaSection } from "./Hxoa";
import { ACT_APPROVE, ACT_REJECT, TaskCard } from "./TaskCard";

const ACTIVE = new Set(["waiting", "running"]);
const rank = (t: TaskSnapshot) => (t.state === "waiting" ? 0 : t.state === "running" ? 1 : 2);
type Ask = { task: TaskSnapshot; option: PromptOption };

// 编程工作台 (#126) 单独一个包, 进 #/agent/gui 才加载
const AgentGui = lazy(() => import("./gui"));

export default function AgentArea(props: AreaProps) {
  if (props.loc.path[0] === "gui")
    return (
      <Suspense fallback={null}>
        <AgentGui {...props} />
      </Suspense>
    );
  return <AgentHome />;
}

// 只在主账号看得到入口卡时补拉收件箱 (要显示 "等你 n")
function GuiEntry() {
  const hub = useInbox();
  const n = hub.cards.length;
  return (
    <a href="#/agent/gui" className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:bg-muted [&_svg]:size-5">
      <Code className="text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">编程 (Agent GUI)</span>
        <span className="block text-xs text-muted-foreground">在电脑上驱动编程 Agent: 工作台与审批</span>
      </span>
      {n > 0 && <Badge variant="destructive">等你 {n}</Badge>}
    </a>
  );
}

// Agent 栏 (对照安卓 AgentPage.kt): 接入的电脑在顶部; 等待确认, 运行中, 已结束依次排; 卡片上直接批准 / 拒绝
function AgentHome() {
  const snap = useFeed();
  const state = useLinkState();
  const owner = useUser()?.role === "owner";
  const [asking, setAsking] = useState<Ask | null>(null);
  const all = Object.values(snap.tasks).sort((a, b) => rank(a) - rank(b) || b.updated - a.updated);
  const active = all.filter((t) => ACTIVE.has(t.state));
  const ended = all.filter((t) => !ACTIVE.has(t.state));
  const stale = state !== "online";

  const answer = (task: TaskSnapshot, option: PromptOption) => {
    if (task.prompt?.danger || option.style === "danger") return setAsking({ task, option });
    submit(task, option, false);
  };

  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader title="Agent" sub={stale ? "未连接, 显示的是上次的状态" : undefined} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3 pb-6">
          {owner && <GuiEntry />}
          {snap.notice && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm text-warning">
              <span className="min-w-0 flex-1">{snap.notice}</span>
              <Button size="sm" variant="ghost" onClick={() => feed.dismissNotice()}>
                知道了
              </Button>
            </div>
          )}
          {snap.agents.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {snap.agents.map((a) => (
                <Badge key={a.id} variant="outline" dot={a.online ? "success" : "muted"} title={a.desc}>
                  {a.name} {a.online ? "在线" : "离线"}
                </Badge>
              ))}
            </div>
          )}
          <h3 className="text-sm font-medium text-muted-foreground">进行中</h3>
          {!snap.loaded ? (
            <EmptyState>{stale ? "连上后加载" : TXT_LOADING}</EmptyState>
          ) : active.length === 0 ? (
            <EmptyState>没有进行中的任务</EmptyState>
          ) : (
            active.map((t) => <TaskCard key={t.id} task={t} pending={snap.pending[t.id]} onOption={stale ? undefined : (o) => answer(t, o)} />)
          )}
          {ended.length > 0 && <h3 className="text-sm font-medium text-muted-foreground">已结束</h3>}
          {ended.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
          {/* hxoa 的工作区与 worker 也算 agent harness, 放在最后 (#144); 只有主人能管 */}
          {owner && <HxoaSection />}
        </div>
      </div>
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(o) => !o && setAsking(null)}
        title="确认执行?"
        description={asking ? `${asking.task.title}: ${asking.option.label}。这会触发真实操作。` : undefined}
        confirmLabel={asking?.option.label}
        tone="destructive"
        onConfirm={() => {
          if (asking) submit(asking.task, asking.option, true);
          setAsking(null);
        }}
      />
    </div>
  );
}

// 默认选项映射成 approve / reject, Agent 自定义的一律 approve + option
function submit(task: TaskSnapshot, option: PromptOption, confirm: boolean): void {
  if (option.id === ACT_APPROVE || option.id === ACT_REJECT) feed.act(task.id, option.id, undefined, confirm);
  else feed.act(task.id, ACT_APPROVE, option.id, confirm);
}

