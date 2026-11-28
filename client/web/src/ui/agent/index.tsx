import type { PromptOption, TaskSnapshot } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { useState } from "react";
import { useFeed, useLinkState } from "../../app/hooks";
import { TXT_LOADING } from "../../core/constants";
import { feed } from "../../core/feed";
import { EmptyState, PageHeader } from "../kit/Panes";
import type { AreaProps } from "../Shell";
import { ACT_APPROVE, ACT_REJECT, TaskCard } from "./TaskCard";

const ACTIVE = new Set(["waiting", "running"]);
const rank = (t: TaskSnapshot) => (t.state === "waiting" ? 0 : t.state === "running" ? 1 : 2);
type Ask = { task: TaskSnapshot; option: PromptOption };

// Agent 栏 (对照安卓 AgentPage.kt): 接入的电脑在顶部; 等待确认, 运行中, 已结束依次排; 卡片上直接批准 / 拒绝
export default function AgentArea(_: AreaProps) {
  const snap = useFeed();
  const state = useLinkState();
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

