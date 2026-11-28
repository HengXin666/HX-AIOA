import { Card } from "@hx/ui/ui/card";
import type { PromptOption, TaskSnapshot, TaskState } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Progress } from "@hx/ui/ui/progress";
import { Activity, Bell } from "lucide-react";
import { HARNESS } from "../../core/constants";
import { shortTime } from "../ChatList";

type Dot = "warning" | "destructive" | "success" | "info" | "muted";
const PHASE: Record<TaskState, { label: string; dot: Dot }> = {
  running: { label: "运行中", dot: "info" },
  waiting: { label: "等待确认", dot: "warning" },
  done: { label: "完成", dot: "success" },
  failed: { label: "失败", dot: "destructive" },
  cancelled: { label: "已取消", dot: "muted" },
};

export const ACT_APPROVE = "approve";
export const ACT_REJECT = "reject";
// Agent 没给选项时的默认 批准 / 拒绝
const DEFAULT_OPTIONS: PromptOption[] = [
  { id: ACT_APPROVE, label: "批准", style: "primary" },
  { id: ACT_REJECT, label: "拒绝" },
];

export const optionsOf = (t: TaskSnapshot): PromptOption[] => (t.prompt?.options.length ? t.prompt.options : DEFAULT_OPTIONS);
export const expiredOf = (t: TaskSnapshot): boolean => Boolean(t.prompt?.expired) || (t.prompt?.expires ?? Infinity) < Date.now();

// 任务卡 (对照安卓 kit/TaskCard.kt): 等待确认时直接给选项, 危险操作由上层二次确认
export function TaskCard({ task, pending, onOption }: { task: TaskSnapshot; pending?: string; onOption?: (o: PromptOption) => void }) {
  const phase = PHASE[task.state] ?? PHASE.running;
  const waiting = task.state === "waiting";
  const expired = waiting && expiredOf(task);
  const result = task.result ?? task.error;
  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-3.5">
        {waiting ? <Bell /> : <Activity />}
        <span className="min-w-0 flex-1 truncate">{task.agent || HARNESS}</span>
        <span>{shortTime(task.updated)}</span>
      </div>
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 text-sm font-semibold break-words text-foreground">{task.title}</h4>
        <Badge variant="outline" dot={phase.dot}>
          {phase.label}
        </Badge>
      </div>
      {task.summary && <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">{task.summary}</p>}
      {task.state === "running" && typeof task.progress === "number" && <Progress value={task.progress * 100} />}
      {task.step && <p className="text-xs text-muted-foreground">{task.step}</p>}
      {waiting && task.prompt?.question && <p className="text-sm break-words text-foreground">{task.prompt.question}</p>}
      {waiting && task.prompt?.danger && <p className="text-xs text-destructive">危险操作, 提交前会再次确认</p>}
      {expired && <p className="text-xs text-warning">已超时, 无法再处理</p>}
      {waiting && !expired && onOption && (
        <div className="flex flex-wrap gap-2">
          {optionsOf(task).map((o) => (
            <Button key={o.id} size="sm" variant={o.style === "danger" ? "destructive" : o.style === "primary" ? "default" : "outline"} disabled={pending !== undefined} onClick={() => onOption(o)}>
              {pending === o.id ? `${o.label}...` : o.label}
            </Button>
          ))}
        </div>
      )}
      {!waiting && result && <p className="text-xs break-words whitespace-pre-wrap text-muted-foreground">{result}</p>}
    </Card>
  );
}
