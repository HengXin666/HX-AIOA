import type { OverviewItem, TaskSnapshot } from "@hx-aioa/protocol";
import { chats, groupOf } from "./chats";
import { Emitter } from "./emitter";
import type { FeedSnapshot } from "./feed";

const STORAGE_SEEN = "aioa.overview.seen";
const SEEN_KEEP = 400;
const KIND_TASK = "task";

// 总览里划掉或点开看过的 "需要我" (对照安卓 SeenStore): 每台设备各记各的
class SeenStore {
  readonly changed = new Emitter<void>();
  private map: Record<string, number> = load();
  version = 0;

  has = (id: string): boolean => id in this.map;

  mark(ids: string[]): void {
    if (!ids.length) return;
    const now = Date.now();
    for (const id of ids) this.map[id] = now;
    const keys = Object.keys(this.map);
    if (keys.length > SEEN_KEEP) keys.sort((a, b) => this.map[a]! - this.map[b]!).slice(0, keys.length - SEEN_KEEP).forEach((k) => delete this.map[k]);
    localStorage.setItem(STORAGE_SEEN, JSON.stringify(this.map));
    this.version += 1;
    this.changed.emit();
  }
}

function load(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_SEEN) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export const seen = new SeenStore();

// 已在群里读到的不再算 "需要我": 群的已读位置服务端同步, 手机上看过这里也跟着消失
function readInChat(it: OverviewItem): boolean {
  const g = groupOf(it.ev);
  const read = g ? (chats.meta(g)?.read ?? 0) : 0;
  return it.ev.seq > 0 && it.ev.seq <= read;
}

export type Attention = { items: OverviewItem[]; waiting: TaskSnapshot[]; total: number };

// 任务的 need_me 事件和等待中的任务是同一件事, 只按任务算一次
export function attentionOf(snap: FeedSnapshot): Attention {
  const items = (snap.layers.need_me ?? []).filter((it) => it.ev.kind !== KIND_TASK && !it.ids.every(seen.has) && !readInChat(it));
  const waiting = Object.values(snap.tasks)
    .filter((t) => t.state === "waiting")
    .sort((a, b) => b.updated - a.updated);
  return { items, waiting, total: items.length + waiting.length };
}

// 划掉: 只记在本机; 点开进群后群的已读会同步到别的设备
export function dismiss(items: OverviewItem[]): void {
  seen.mark(items.flatMap((it) => it.ids));
}
