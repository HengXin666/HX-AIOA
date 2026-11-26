import { KV_TIMERS } from "./constants";

// DO 只有一个闹钟: 多个定时任务 (兜底推送, 聚合窗口, 确认超时) 共用, 闹钟总是设在最早的到期时间
export class Timers {
  constructor(private readonly storage: DurableObjectStorage) {}

  private async load(): Promise<Record<string, number>> {
    return (await this.storage.get<Record<string, number>>(KV_TIMERS)) ?? {};
  }

  private async save(map: Record<string, number>): Promise<void> {
    if (Object.keys(map).length) await this.storage.put(KV_TIMERS, map);
    else await this.storage.delete(KV_TIMERS);
    const next = Math.min(...Object.values(map));
    if (Number.isFinite(next)) await this.storage.setAlarm(next);
    else await this.storage.deleteAlarm();
  }

  async get(name: string): Promise<number | undefined> {
    return (await this.load())[name];
  }

  // keepEarlier: 已有更早的同名定时不推迟 (用于合并多条兜底推送)
  async set(name: string, due: number, keepEarlier = false): Promise<void> {
    const map = await this.load();
    const cur = map[name];
    if (keepEarlier && cur !== undefined && cur <= due) return;
    map[name] = due;
    await this.save(map);
  }

  async clear(name: string): Promise<void> {
    const map = await this.load();
    if (!(name in map)) return;
    delete map[name];
    await this.save(map);
  }

  // 取出全部到期的名字并重设闹钟
  async takeDue(now: number): Promise<string[]> {
    const map = await this.load();
    const due = Object.keys(map).filter((k) => (map[k] ?? 0) <= now);
    for (const k of due) delete map[k];
    await this.save(map);
    return due;
  }
}
