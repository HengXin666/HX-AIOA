import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Forward, Layers, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PATH_EVENT_BY_SEQ, QUERY_MODE } from "@hx-aioa/protocol";
import { api, fill } from "../../core/auth";
import type { Message } from "../../core/chats";
import { favorite } from "../../core/msg-actions";
import type { ForwardMode } from "./ForwardDialog";

type Props = { items: Message[]; owner: boolean; onForward: (mode: ForwardMode) => void; onDone: () => void };

// 多选操作条 (对照安卓 ch-select): 逐条转发, 合并转发, 收藏, 删除; 替代输入框的位置
export function SelectBar({ items, owner, onForward, onDone }: Props) {
  const none = items.length === 0;
  const run = async (fn: (m: Message) => Promise<unknown>, ok: string) => {
    const results = await Promise.allSettled(items.map(fn));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) toast.error(`${failed} 条没有成功`);
    else toast.success(ok);
    onDone();
  };
  const remove = (m: Message) => api(`${fill(PATH_EVENT_BY_SEQ, String(m.seq))}?${QUERY_MODE}=delete`, { method: "DELETE" });

  return (
    <div className="safe-bottom border-t border-border p-3">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-muted-foreground">已选 {items.length} 条</span>
        <Button size="sm" variant="outline" disabled={none} onClick={() => onForward("each")}>
          <Forward />
          逐条转发
        </Button>
        <Button size="sm" variant="outline" disabled={none} onClick={() => onForward("bundle")}>
          <Layers />
          合并转发
        </Button>
        {owner && (
          <Button size="sm" variant="outline" disabled={none} onClick={() => void run((m) => favorite(m.seq), "已收藏")}>
            <Star />
            收藏
          </Button>
        )}
        {owner && (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="outline" disabled={none}>
                <Trash2 />
                删除
              </Button>
            }
            title={`删除 ${items.length} 条消息?`}
            description="所有人的记录里都会删掉, 不能恢复。"
            confirmLabel="删除"
            tone="destructive"
            onConfirm={() => run(remove, "已删除")}
          />
        )}
        <Button size="icon-sm" variant="ghost" aria-label="退出多选" onClick={onDone}>
          <X />
        </Button>
      </div>
    </div>
  );
}
