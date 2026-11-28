import type { PromptOption, TaskSnapshot } from "@hx-aioa/protocol";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { useState, type ReactNode } from "react";
import { feed } from "../../core/feed";
import { ACT_APPROVE, ACT_REJECT } from "./TaskCard";

// 回答等待确认的任务 (Agent 栏与总览共用): 危险操作先二次确认; 返回 [回答函数, 确认框]
export function useAnswer(): [(task: TaskSnapshot, option: PromptOption) => void, ReactNode] {
  const [asking, setAsking] = useState<{ task: TaskSnapshot; option: PromptOption } | null>(null);
  const answer = (task: TaskSnapshot, option: PromptOption) => {
    if (task.prompt?.danger || option.style === "danger") return setAsking({ task, option });
    submit(task, option, false);
  };
  const dialog = (
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
  );
  return [answer, dialog];
}

// 默认选项映射成 approve / reject, Agent 自定义的一律 approve + option
function submit(task: TaskSnapshot, option: PromptOption, confirm: boolean): void {
  if (option.id === ACT_APPROVE || option.id === ACT_REJECT) feed.act(task.id, option.id, undefined, confirm);
  else feed.act(task.id, ACT_APPROVE, option.id, confirm);
}
