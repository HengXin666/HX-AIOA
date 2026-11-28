import { EmptyState, PageHeader } from "../kit/Panes";
import type { AreaProps } from "../Shell";

// Agent 栏: 任务 (进行中 | 已结束) 与 agent harness 列表, 待实现
export default function AgentArea(_: AreaProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader title="Agent" />
      <EmptyState>建设中</EmptyState>
    </div>
  );
}
