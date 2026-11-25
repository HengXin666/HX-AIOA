import { FILE_ID_PREFIX, type Envelope, type FileRef, type FileStoreKind, type FileUsage, FILES_TOTAL_MAX_BYTES, type StorageSettings } from "@hx-aioa/protocol";
import { randomId } from "../auth";
import type { Drive } from "./drive";

export type FileRow = {
  id: string;
  grp: string;
  name: string;
  size: number;
  mime: string;
  by: string;
  created: number;
  done: number;
  refs: number;
  store: FileStoreKind;
  ext: string | null;
};

// 上传后一直没被消息引用的文件, 过这么久就清掉
const ORPHAN_MS = 24 * 3600_000;
// Drive 直链 24 小时有效, 缓存一半时间, 发出去的地址至少还能用 12 小时
const LINK_CACHE_MS = 12 * 3600_000;
const LINK_TTL_MS = 24 * 3600_000;

export const fileOf = (ev: Envelope | null | undefined): FileRef | undefined => (ev && ev.kind === "event" && !ev.deleted ? ev.data.file : undefined);

/** Drive 里的目录: 按月分, 免得一个目录里堆太多文件。 */
export const driveDir = (now = Date.now()) => `/${new Date(now).toISOString().slice(0, 7)}`;
export const driveName = (id: string, name: string) => `${id}_${name}`;

/**
 * 文件元数据: 一行一个文件, refs 是引用它的消息数, 降到 0 就删字节。
 * 每行记自己的后端 (store) 与外部 id (ext, cfd 为 Drive 节点 id); 改存储路由只影响新文件, 老文件按自己的后端读删。
 */
export class FileStore {
  private readonly links = new Map<string, { url: string; at: number }>();

  constructor(
    private readonly sql: SqlStorage,
    private readonly bucket: R2Bucket | undefined,
    readonly drive: Drive | undefined,
  ) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS file (id TEXT PRIMARY KEY, grp TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, by TEXT NOT NULL, created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, refs INTEGER NOT NULL DEFAULT 0)",
    );
    const cols = sql.exec<{ name: string }>("PRAGMA table_info(file)").toArray().map((c) => c.name);
    if (!cols.includes("store")) sql.exec("ALTER TABLE file ADD COLUMN store TEXT NOT NULL DEFAULT 'r2'");
    if (!cols.includes("ext")) sql.exec("ALTER TABLE file ADD COLUMN ext TEXT");
    sql.exec("CREATE INDEX IF NOT EXISTS file_grp ON file (grp)");
    sql.exec("CREATE INDEX IF NOT EXISTS file_orphan ON file (refs, created)");
  }

  /** 有任何一个后端可用就算开了文件功能。 */
  get enabled(): boolean {
    return !!this.bucket || !!this.drive;
  }

  ready(store: FileStoreKind): boolean {
    return store === "r2" ? !!this.bucket : !!this.drive;
  }

  usage(storage: StorageSettings): FileUsage {
    const rows = this.sql.exec<{ store: FileStoreKind; b: number | null; n: number }>("SELECT store, SUM(size) AS b, COUNT(*) AS n FROM file GROUP BY store").toArray();
    const byStore = { r2: { bytes: 0, count: 0 }, cfd: { bytes: 0, count: 0 } };
    for (const r of rows) if (r.store in byStore) byStore[r.store] = { bytes: r.b ?? 0, count: r.n };
    return {
      bytes: byStore.r2.bytes + byStore.cfd.bytes,
      count: byStore.r2.count + byStore.cfd.count,
      limit: FILES_TOTAL_MAX_BYTES,
      byStore,
      ready: { r2: this.ready("r2"), cfd: this.ready("cfd") },
      storage,
    };
  }

  /** 按路由选后端; 选不出来返回 [状态码, 原因]。只在登记新文件时用。 */
  pick(size: number, s: StorageSettings): FileStoreKind | [number, string] {
    let k = size > s.threshold ? s.large : s.small;
    if (k === "off") return [413, `超过 ${Math.round(s.threshold / 1048576)} MB 的文件已关闭上传`];
    if (k === "r2" && this.r2Bytes() + size > FILES_TOTAL_MAX_BYTES) {
      if (s.onFull !== "cfd") return [507, "R2 文件总量已满, 先清理旧文件, 或在存储设置里改走 Drive"];
      k = "cfd";
    }
    if (!this.ready(k)) return [503, k === "r2" ? "服务端还没绑定 R2 文件桶" : "服务端还没接入 HX-CF-Drive"];
    return k;
  }

  private r2Bytes(): number {
    return this.sql.exec<{ b: number | null }>("SELECT SUM(size) AS b FROM file WHERE store = 'r2'").one().b ?? 0;
  }

  create(grp: string, name: string, size: number, mime: string, by: string, store: FileStoreKind = "r2", now = Date.now()): FileRef {
    const id = randomId(FILE_ID_PREFIX);
    this.sql.exec("INSERT INTO file (id, grp, name, size, mime, by, created, store) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, grp, name, size, mime, by, now, store);
    return { id, name, size, mime };
  }

  row(id: string): FileRow | null {
    return this.sql.exec<FileRow>("SELECT * FROM file WHERE id = ?", id).toArray()[0] ?? null;
  }

  ref(id: string): FileRef | null {
    const r = this.row(id);
    return r?.done ? { id: r.id, name: r.name, size: r.size, mime: r.mime } : null;
  }

  /** 服务端自己产生的内容 (如邮件原文), 按路由的 small 后端直接写, 不走上传票据。哪个后端都没有返回 null。 */
  async save(grp: string, name: string, body: string, mime: string, by: string, storage: StorageSettings): Promise<FileRef | null> {
    const size = new TextEncoder().encode(body).length;
    const k = this.pick(size, storage);
    if (Array.isArray(k)) return null;
    const ref = this.create(grp, name, size, mime, by, k);
    if (k === "cfd") {
      const n = await (this.drive as Drive).upload(driveDir(), driveName(ref.id, name), size, mime, body);
      this.done(ref.id, n.size, n.id);
      return { ...ref, size: n.size };
    }
    const obj = await (this.bucket as R2Bucket).put(ref.id, body, { httpMetadata: { contentType: mime } });
    this.done(ref.id, obj.size);
    return { ...ref, size: obj.size };
  }

  async text(id: string): Promise<string | null> {
    const r = this.row(id);
    if (!r?.done) return null;
    if (r.store === "cfd") return r.ext && this.drive ? this.drive.text(r.ext) : null;
    return (await this.bucket?.get(id))?.text() ?? null;
  }

  /** 下载地址: cfd 向 Drive 要签名直链 (缓存 12 小时); r2 返回 null, 由调用方签本站票据。 */
  async driveLink(r: FileRow, now = Date.now()): Promise<{ url: string; expires: number } | null> {
    if (r.store !== "cfd") return null;
    if (!r.ext || !this.drive) throw new Error("服务端还没接入 HX-CF-Drive");
    const hit = this.links.get(r.id);
    if (hit && now - hit.at < LINK_CACHE_MS) return { url: hit.url, expires: hit.at + LINK_TTL_MS };
    const url = await this.drive.link(r.ext, LINK_TTL_MS / 1000);
    this.links.set(r.id, { url, at: now });
    return { url, expires: now + LINK_TTL_MS };
  }

  /** 字节写完后回报: 以后端实际大小为准; cfd 同时记下 Drive 节点 id。行已被删返回 false。 */
  done(id: string, size: number, ext?: string): boolean {
    return this.sql.exec("UPDATE file SET done = 1, size = ?, ext = COALESCE(?, ext) WHERE id = ?", size, ext ?? null, id).rowsWritten > 0;
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
    await this.drop(this.sql.exec<FileRow>("SELECT * FROM file WHERE id = ?", id).toArray());
  }

  /** 清空群: 群里上传的文件一并删除。 */
  async dropGroup(grp: string): Promise<number> {
    return this.drop(this.sql.exec<FileRow>("SELECT * FROM file WHERE grp = ?", grp).toArray());
  }

  /** 定时清理: 没被任何消息引用且超过一天的 (上传失败, 传了没发, 上次 Drive 没删成功的)。 */
  async sweep(now = Date.now()): Promise<number> {
    return this.drop(this.sql.exec<FileRow>("SELECT * FROM file WHERE refs <= 0 AND created < ?", now - ORPHAN_MS).toArray());
  }

  /**
   * 删字节再删行。R2 批量删; Drive 逐个删 (当场删 TG 消息), 删失败的行保留,
   * 改成未完成且无引用, 发不出去, 也换不了地址, 由每天的 sweep 重试。返回删掉的行数。
   */
  private async drop(rows: FileRow[]): Promise<number> {
    if (!rows.length) return 0;
    const gone: string[] = [];
    const r2 = rows.filter((r) => r.store !== "cfd").map((r) => r.id);
    if (r2.length) {
      await this.bucket?.delete(r2);
      gone.push(...r2);
    }
    for (const r of rows.filter((x) => x.store === "cfd")) {
      this.links.delete(r.id);
      if (!r.ext) {
        gone.push(r.id);
        continue;
      }
      try {
        if (!this.drive) throw new Error("no drive");
        await this.drive.remove(r.ext);
        gone.push(r.id);
      } catch {
        this.sql.exec("UPDATE file SET done = 0, refs = 0, created = MIN(created, ?) WHERE id = ?", Date.now() - ORPHAN_MS - 1, r.id);
      }
    }
    for (const id of gone) this.sql.exec("DELETE FROM file WHERE id = ?", id);
    return gone.length;
  }
}
