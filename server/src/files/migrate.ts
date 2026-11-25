import { type FileStoreKind, type MigrateJob, type StorageSettings } from "@hx-aioa/protocol";
import type { Timers } from "../timers";
import type { FileStore } from "./store";

export const TIMER_MIGRATE = "files:migrate";
const KV_MIGRATE = "files:migrate";
// 每轮搬几个, 两轮之间隔多久: 一轮里 R2 与 Drive 各几次子请求, 留够余量; Drive 受 TG 每分钟 20 条限制
const BATCH = 3;
const GAP_MS = 10_000;
// 失败的 id 记下来不再重试, 记太多就停下
const SKIP_MAX = 200;

type Saved = MigrateJob & { skip: string[]; coldDays: number };

/**
 * 迁移任务: 一次只有一个, 状态存在 DO 存储里, 由闹钟分批推进 (DO 重启后接着跑)。
 * 每个文件先写新后端, 再改行, 最后删旧字节; 文件 id 不变, 消息与本机缓存都不受影响。
 */
export class Migrator {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly files: FileStore,
    private readonly timers: Timers,
  ) {}

  private async load(): Promise<Saved | null> {
    return (await this.storage.get<Saved>(KV_MIGRATE)) ?? null;
  }

  async status(): Promise<MigrateJob | null> {
    const s = await this.load();
    if (!s) return null;
    const { skip: _skip, coldDays: _cold, ...job } = s;
    return job;
  }

  /** 开始迁移; 已有任务在跑时返回错误。cold 只搬 storage.coldDays 天没下载过的 R2 文件到 Drive。 */
  async start(to: FileStoreKind, cold: boolean, storage: StorageSettings, now = Date.now()): Promise<MigrateJob | string> {
    const cur = await this.load();
    if (cur && !cur.finished) return "已经有一个迁移任务在跑";
    if (!this.files.ready("r2") || !this.files.ready("cfd")) return "R2 和 HX-CF-Drive 都接入后才能迁移";
    if (cold && (to !== "cfd" || storage.coldDays <= 0)) return "冷迁移只搬到 Drive, 且要先设置 coldDays";
    const coldDays = cold ? storage.coldDays : 0;
    const { total } = this.files.candidates(to, coldDays, [], 0, now);
    const job: Saved = { to, cold, started: now, moved: 0, bytes: 0, failed: 0, skipped: to === "r2" ? this.files.tooBigForR2() : 0, left: total, skip: [], coldDays };
    if (!total) job.finished = now;
    await this.storage.put(KV_MIGRATE, job);
    if (total) await this.timers.set(TIMER_MIGRATE, now);
    return (await this.status()) as MigrateJob;
  }

  async stop(now = Date.now()): Promise<MigrateJob | null> {
    const s = await this.load();
    if (s && !s.finished) {
      s.finished = now;
      s.error = "已手动停止";
      await this.storage.put(KV_MIGRATE, s);
      await this.timers.clear(TIMER_MIGRATE);
    }
    return this.status();
  }

  /** 闹钟到了: 搬一批, 还有就约下一轮。 */
  async tick(now = Date.now()): Promise<void> {
    const s = await this.load();
    if (!s || s.finished) return;
    const { rows } = this.files.candidates(s.to, s.coldDays, s.skip, BATCH, now);
    for (const r of rows) {
      try {
        await this.files.move(r, s.to);
        s.moved++;
        s.bytes += r.size;
      } catch (e) {
        s.failed++;
        s.skip.push(r.id);
        s.error = `${r.name}: ${(e as Error).message}`;
        // R2 满了不用再试别的
        if (/总量已满/.test(s.error)) s.finished = now;
      }
    }
    s.left = this.files.candidates(s.to, s.coldDays, s.skip, 0, now).total;
    if (s.skip.length >= SKIP_MAX) {
      s.finished = now;
      s.error = `失败太多 (${s.skip.length} 个), 已停止; 最后一个: ${s.error}`;
    }
    if (!s.left) s.finished ??= now;
    await this.storage.put(KV_MIGRATE, s);
    if (!s.finished) await this.timers.set(TIMER_MIGRATE, now + GAP_MS);
  }
}
