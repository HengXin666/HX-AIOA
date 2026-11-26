import { TODO_COLL, TODO_PLUGIN, type TodoBody } from "@hx-aioa/protocol";
import type { Timers } from "../timers";
import type { PDataStore } from "./pdata";
import { fireAt } from "./todo-plan";

export const TIMER_TODO = "todo_remind";
const KEY_LAST = "todo_remind_last";
// 停机或休眠太久错过的提醒: 超过 6 小时就不补发了, 免得一次冒出一堆过时的
const STALE_MS = 6 * 3_600_000;

export type Due = { acct: string; id: string; body: TodoBody; at: number };
export type RemindPost = (d: Due) => Promise<void>;

/**
 * 待办到点提醒 (#105): 所有账号的待办里取最早一个还没提醒过的时刻, 挂在 DO 共用的闹钟上;
 * 到点把 (上次, 现在] 之间该提醒的逐条发成系统消息, 再排下一个。只记一个 "上次提醒到哪" 的时间戳, 不逐条落库。
 */
export class TodoRemind {
  private queued = false;

  constructor(
    private readonly pdata: PDataStore,
    private readonly timers: Timers,
    private readonly storage: DurableObjectStorage,
    private readonly post: RemindPost,
    private readonly enabled: (acct: string) => boolean,
  ) {}

  /** 待办有变动时调用: 同一轮里多次变动只排一次。 */
  kick(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.plan().catch((e) => console.error("待办提醒排程失败:", e));
    });
  }

  // 第一次用时从现在算起, 部署前就过了的不补
  private async last(): Promise<number> {
    const v = await this.storage.get<number>(KEY_LAST);
    if (v !== undefined) return v;
    const now = Date.now();
    await this.storage.put(KEY_LAST, now);
    return now;
  }

  private rows(): Due[] {
    return this.pdata.allLive(TODO_PLUGIN, TODO_COLL).flatMap(({ acct, item }) => {
      const body = item.body as TodoBody;
      const at = fireAt(body);
      return at === null ? [] : [{ acct, id: item.id, body, at }];
    });
  }

  async plan(): Promise<number | null> {
    const last = await this.last();
    let next = Infinity;
    for (const d of this.rows()) if (d.at > last && d.at < next && this.enabled(d.acct)) next = d.at;
    const want = Number.isFinite(next) ? next : undefined;
    // 和已挂的一样就不写, 冷启动也不多一次写入
    if ((await this.timers.get(TIMER_TODO)) === want) return want ?? null;
    if (want === undefined) await this.timers.clear(TIMER_TODO);
    else await this.timers.set(TIMER_TODO, want);
    return want ?? null;
  }

  /** 闹钟到了: 发 (上次, 现在] 之间的提醒; 返回发了几条。 */
  async fire(now = Date.now()): Promise<number> {
    const last = await this.last();
    const due = this.rows().filter((d) => d.at > last && d.at <= now && this.enabled(d.acct));
    await this.storage.put(KEY_LAST, now);
    let sent = 0;
    for (const d of due.sort((a, b) => a.at - b.at)) {
      if (now - d.at > STALE_MS) continue;
      try {
        await this.post(d);
        sent++;
      } catch (e) {
        console.error("待办提醒发送失败:", d.id, e);
      }
    }
    await this.plan();
    return sent;
  }
}
