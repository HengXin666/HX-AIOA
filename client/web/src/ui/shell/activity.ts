import type { Envelope } from "@hx-aioa/protocol";
import { useEffect, useSyncExternalStore } from "react";
import { chats } from "../../core/chats";
import { Emitter } from "../../core/emitter";
import { recentEvents } from "../../core/pulse";

// 最近一段消息事件, 侧栏与总览共用一份: 第一次有人要时取一次历史, 之后由会话库的新消息实时补进来, 不轮询
class ActivityStore {
  readonly changed = new Emitter<void>();
  private events: Envelope[] | null = null;
  private seqs = new Set<number>();
  private loading = false;
  private users = 0;
  private off: (() => void) | null = null;

  snapshot = (): Envelope[] | null => this.events;

  use(): () => void {
    this.users++;
    if (!this.off) this.off = chats.changed.on(() => this.follow());
    this.follow();
    return () => {
      this.users--;
      if (this.users > 0 || !this.off) return;
      this.off();
      this.off = null;
    };
  }

  private follow(): void {
    const head = chats.latest();
    if (!head) return;
    if (!this.events) {
      if (this.loading) return;
      this.loading = true;
      void recentEvents(head)
        .then((evs) => this.set(evs), () => this.set([]))
        .finally(() => (this.loading = false));
      return;
    }
    // 各群最新一条: 新到的补进来, 已有的按 seq 去重
    const fresh = Object.values(chats.snapshot().last).filter((m) => m && !this.seqs.has(m.seq)) as Envelope[];
    if (fresh.length) this.set([...this.events, ...fresh]);
  }

  private set(evs: Envelope[]): void {
    this.events = evs;
    this.seqs = new Set(evs.map((e) => e.seq));
    this.changed.emit();
  }
}

export const activity = new ActivityStore();

export function useActivity(): Envelope[] | null {
  useEffect(() => activity.use(), []);
  return useSyncExternalStore((fn) => activity.changed.on(fn), activity.snapshot);
}

const HOUR_MS = 3_600_000;
export const DAY_HOURS = 24;

// 最近 24 小时每小时多少条 (从 23 小时前到这一小时), 侧栏迷你图与总览共用
export function hourly(events: Envelope[] | null, now = Date.now()): number[] {
  const out = Array.from({ length: DAY_HOURS }, () => 0);
  if (!events) return out;
  const end = Math.floor(now / HOUR_MS);
  for (const e of events) {
    const i = DAY_HOURS - 1 - (end - Math.floor(e.ts / HOUR_MS));
    if (i >= 0 && i < DAY_HOURS) out[i]!++;
  }
  return out;
}
