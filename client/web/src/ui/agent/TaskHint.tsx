import { SETUP_TASK_FILL, SETUP_TASK_KEEP, SETUP_TASK_MARK } from "@hx-aioa/protocol";
import { Alert, AlertDescription, AlertTitle } from "@hx/ui/ui/alert";
import { Info, PencilLine } from "lucide-react";
import { TXT_TASK_FILL, TXT_TASK_KEEP, TXT_TASK_SET } from "./onboard-text";

// 接入语上方的任务提示 (#165), 与安卓 ui/agents/AgentSend.kt 的 TaskHint 一致
export function TaskHint({ prompt }: { prompt: string }) {
  if (prompt.includes(SETUP_TASK_FILL)) {
    return (
      <Alert variant="warning">
        <PencilLine />
        <AlertTitle>先填任务再发</AlertTitle>
        <AlertDescription>{TXT_TASK_FILL}</AlertDescription>
      </Alert>
    );
  }
  const text = prompt.includes(SETUP_TASK_KEEP) ? TXT_TASK_KEEP : prompt.includes(SETUP_TASK_MARK) ? TXT_TASK_SET : null;
  if (!text) return null;
  return (
    <Alert variant="info">
      <Info />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}
