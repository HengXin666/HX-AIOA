import type { PresenceEntry } from "@hx-aioa/protocol";
import { Emitter } from "./emitter";
import { link } from "./link";

export type Presence = { listening: PresenceEntry[]; typing: PresenceEntry[] };
const EMPTY: Presence = { listening: [], typing: [] };

// 群里谁在听 / 在输入: 只认推送帧, 按 until 到点自己隐藏 (一个本地定时器, 不问服务端)
class PresenceStore {
  readonly changed = new Emitter<void>();
  private map = new Map<string, Presence>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;

  attach(): () => void {
    const off = link.frames.on((f) => {
      if (f.t !== "presence" || typeof f.channel !== "string") return;
      this.map.set(f.channel, { listening: list(f.listening), typing: list(f.typing) });
      this.bump();
    });
    return () => {
      off();
      clearTimeout(this.timer);
      this.map.clear();
    };
  }

  get = (channel: string): Presence => {
    const p = this.map.get(channel);
    if (!p) return EMPTY;
    return p;
  };

  stamp = (): number => this.version;

  private bump(): void {
    const now = Date.now();
    let next = Infinity;
    for (const [ch, p] of this.map) {
      const alive = (e: PresenceEntry) => e.until === undefined || e.until > now;
      const q = { listening: p.listening.filter(alive), typing: p.typing.filter(alive) };
      if (q.listening.length !== p.listening.length || q.typing.length !== p.typing.length) this.map.set(ch, q);
      for (const e of [...q.listening, ...q.typing]) if (e.until !== undefined && e.until < next) next = e.until;
    }
    this.version++;
    this.changed.emit();
    clearTimeout(this.timer);
    if (next < Infinity) this.timer = setTimeout(() => this.bump(), Math.max(50, next - now));
  }
}

function list(v: unknown): PresenceEntry[] {
  return Array.isArray(v) ? v.filter((e): e is PresenceEntry => typeof e?.id === "string" && typeof e?.name === "string") : [];
}

export const presence = new PresenceStore();
