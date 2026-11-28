import type { OverviewItem, TaskSnapshot } from "@hx-aioa/protocol";
import { chats, groupOf } from "./chats";
import type { FeedSnapshot } from "./feed";
import { seen } from "./seen";

const KIND_TASK = "task";

// 已在群里读到的不再算 "需要我": 群的已读位置服务端同步, 手机上看过这里也跟着消失
export function readInChat(it: OverviewItem): boolean {
  const g = groupOf(it.ev);
  const read = g ? (chats.meta(g)?.read ?? 0) : 0;
  return it.ev.seq > 0 && it.ev.seq <= read;
}

export type Attention = { items: OverviewItem[]; waiting: TaskSnapshot[]; total: number };

// 一层里还该显示的: 任务由任务卡展示; 本机划掉的, 群里已读的 (服务端同步, 换设备也一致) 都不算
export const pending = (items: OverviewItem[] | undefined): OverviewItem[] => (items ?? []).filter((it) => it.ev.kind !== KIND_TASK && !it.ids.every((id) => seen.has(id)) && !readInChat(it));

// 任务的 need_me 事件和等待中的任务是同一件事, 只按任务算一次
export function attentionOf(snap: FeedSnapshot): Attention {
  const items = pending(snap.layers.need_me);
  const waiting = Object.values(snap.tasks)
    .filter((t) => t.state === "waiting")
    .sort((a, b) => b.updated - a.updated);
  return { items, waiting, total: items.length + waiting.length };
}



export { seen };
