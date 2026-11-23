import { FILE_ID_PREFIX, type Envelope, type FileRef, type FileUsage, FILES_TOTAL_MAX_BYTES } from "@hx-aioa/protocol";
import { randomId } from "../auth";

type Row = { id: string; grp: string; name: string; size: number; mime: string; by: string; created: number; done: number; refs: number };

// 上传后一直没被消息引用的文件, 过这么久就清掉
const ORPHAN_MS = 24 * 3600_000;

export const fileOf = (ev: Envelope | null | undefined): FileRef | undefined => (ev && ev.kind === "event" && !ev.deleted ? ev.data.file : undefined);

/** 文件元数据: 一行一个文件, refs 是引用它的消息数, 降到 0 就从 R2 删掉。字节只在 R2。 */
export class FileStore {
  constructor(
    private readonly sql: SqlStorage,
    private readonly bucket: R2Bucket | undefined,
  ) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS file (id TEXT PRIMARY KEY, grp TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, by TEXT NOT NULL, created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, refs INTEGER NOT NULL DEFAULT 0)",
    );
    sql.exec("CREATE INDEX IF NOT EXISTS file_grp ON file (grp)");
    sql.exec("CREATE INDEX IF NOT EXISTS file_orphan ON file (refs, created)");
  }

  get enabled(): boolean {
    return !!this.bucket;
  }

  usage(): FileUsage {
    const r = this.sql.exec<{ b: number | null; n: number }>("SELECT SUM(size) AS b, COUNT(*) AS n FROM file").one();
    return { bytes: r.b ?? 0, count: r.n, limit: FILES_TOTAL_MAX_BYTES };
  }

  create(grp: string, name: string, size: number, mime: string, by: string, now = Date.now()): FileRef {
    const id = randomId(FILE_ID_PREFIX);
    this.sql.exec("INSERT INTO file (id, grp, name, size, mime, by, created) VALUES (?, ?, ?, ?, ?, ?, ?)", id, grp, name, size, mime, by, now);
    return { id, name, size, mime };
  }

  row(id: string): Row | null {
    return this.sql.exec<Row>("SELECT * FROM file WHERE id = ?", id).toArray()[0] ?? null;
  }

  ref(id: string): FileRef | null {
    const r = this.row(id);
    return r?.done ? { id: r.id, name: r.name, size: r.size, mime: r.mime } : null;
  }

  /** Worker 写完 R2 后回报: 以 R2 实际大小为准。 */
  done(id: string, size: number): boolean {
    return this.sql.exec("UPDATE file SET done = 1, size = ? WHERE id = ?", size, id).rowsWritten > 0;
  }

  /** 消息入库 / 撤回后调整引用: 新版本带的 +1, 旧版本带的 -1。 */
  async track(prev: Envelope | null | undefined, next: Envelope): Promise<void> {
    const a = fileOf(prev)?.id;
    const b = fileOf(next)?.id;
    if (a === b) return;
    if (b) this.sql.exec("UPDATE file SET refs = refs + 1 WHERE id = ?", b);
    if (a) {
      this.sql.exec("UPDATE file SET refs = refs - 1 WHERE id = ?", a);
      const r = this.row(a);
      if (r && r.refs <= 0) await this.remove(a);
    }
  }

  async remove(id: string): Promise<void> {
    this.sql.exec("DELETE FROM file WHERE id = ?", id);
    await this.bucket?.delete(id);
  }

  /** 清空群: 群里上传的文件一并删除。 */
  async dropGroup(grp: string): Promise<number> {
    const ids = this.sql.exec<{ id: string }>("SELECT id FROM file WHERE grp = ?", grp).toArray().map((r) => r.id);
    if (!ids.length) return 0;
    this.sql.exec("DELETE FROM file WHERE grp = ?", grp);
    await this.bucket?.delete(ids);
    return ids.length;
  }

  /** 定时清理: 没被任何消息引用且超过一天的 (上传失败, 传了没发)。 */
  async sweep(now = Date.now()): Promise<number> {
    const ids = this.sql.exec<{ id: string }>("SELECT id FROM file WHERE refs <= 0 AND created < ?", now - ORPHAN_MS).toArray().map((r) => r.id);
    if (!ids.length) return 0;
    this.sql.exec("DELETE FROM file WHERE refs <= 0 AND created < ?", now - ORPHAN_MS);
    await this.bucket?.delete(ids);
    return ids.length;
  }
}
