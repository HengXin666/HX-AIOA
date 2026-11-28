import { useSyncExternalStore } from "react";
import { Emitter } from "./emitter";

// 总览里看过或划掉的条目 (对照安卓 SeenStore.kt): 记 id 与时间, 只存本机, 保留最近的若干条
const KEY = "aioa.overview.seen";
const KEEP = 400;

class SeenStore {
  readonly changed = new Emitter<void>();
  version = 0;
  private map: Record<string, number> = load();

  has(id: string): boolean {
    return id in this.map;
  }

  mark(ids: string[]): void {
    if (!ids.length) return;
    const now = Date.now();
    for (const id of ids) this.map[id] = now;
    const keys = Object.keys(this.map);
    if (keys.length > KEEP) {
      for (const k of keys.sort((a, b) => this.map[a]! - this.map[b]!).slice(0, keys.length - KEEP)) delete this.map[k];
    }
    localStorage.setItem(KEY, JSON.stringify(this.map));
    this.version += 1;
    this.changed.emit();
  }
}

function load(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export const seen = new SeenStore();
export const useSeen = () => useSyncExternalStore((fn) => seen.changed.on(fn), () => seen.version);
