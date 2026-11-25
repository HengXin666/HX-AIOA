import { MAX_PDATA_BODY, MAX_PDATA_PAGE, MAX_PDATA_ROWS, type Contribution, type PDataItem, type PDataList } from "@hx-aioa/protocol";

type Row = { id: string; ver: number; rev: number; updated: number; deleted: number; body: string | null };
export type PutResult = { ok: PDataItem } | { conflict: PDataItem | null } | { error: string };

const toItem = (r: Row): PDataItem => ({
  id: r.id,
  ver: r.ver,
  rev: r.rev,
  updated: r.updated,
  ...(r.deleted ? { deleted: true as const } : { body: JSON.parse(r.body ?? "null") }),
});

const typeOf = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/** 按集合声明校验: 只能有声明过的字段, 类型要对; 没声明 fields 的集合只要求是对象。 */
export function checkBody(coll: Contribution, body: unknown): string | null {
  if (typeOf(body) !== "object") return "body 必须是对象";
  const text = JSON.stringify(body);
  if (text.length > MAX_PDATA_BODY) return `body 超过 ${MAX_PDATA_BODY} 字`;
  if (!coll.fields) return null;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const want = coll.fields[k];
    if (!want) return `集合 ${coll.id} 没有声明字段 ${k}`;
    if (v !== null && typeOf(v) !== want) return `字段 ${k} 应为 ${want}`;
  }
  return null;
}

/**
 * 插件通用数据层: (账号, 插件, 集合, id) 一行。ver 做乐观锁 (不匹配 409), 删除写墓碑,
 * rev 是 (账号, 插件) 内递增的变更序号, 客户端按 since 增量同步。
 */
export class PDataStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS pdata (acct TEXT NOT NULL, plugin TEXT NOT NULL, coll TEXT NOT NULL, id TEXT NOT NULL, ver INTEGER NOT NULL, rev INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, body TEXT, PRIMARY KEY (acct, plugin, coll, id))",
    );
    sql.exec("CREATE INDEX IF NOT EXISTS pdata_rev ON pdata (acct, plugin, rev)");
  }

  private row(acct: string, plugin: string, coll: string, id: string): Row | undefined {
    return this.sql.exec<Row>("SELECT id, ver, rev, updated, deleted, body FROM pdata WHERE acct = ? AND plugin = ? AND coll = ? AND id = ?", acct, plugin, coll, id).toArray()[0];
  }

  private nextRev(acct: string, plugin: string): number {
    const r = this.sql.exec<{ m: number | null }>("SELECT MAX(rev) AS m FROM pdata WHERE acct = ? AND plugin = ?", acct, plugin).one();
    return (r.m ?? 0) + 1;
  }

  list(acct: string, plugin: string, coll: string, since = 0, limit = MAX_PDATA_PAGE): PDataList {
    const n = Math.max(1, Math.min(limit, MAX_PDATA_PAGE));
    const rows = this.sql
      .exec<Row>("SELECT id, ver, rev, updated, deleted, body FROM pdata WHERE acct = ? AND plugin = ? AND coll = ? AND rev > ? ORDER BY rev LIMIT ?", acct, plugin, coll, since, n + 1)
      .toArray();
    const more = rows.length > n;
    const items = rows.slice(0, n).map(toItem);
    return { items, rev: items.length ? items[items.length - 1]!.rev : since, more };
  }

  get(acct: string, plugin: string, coll: string, id: string): PDataItem | null {
    const r = this.row(acct, plugin, coll, id);
    return r ? toItem(r) : null;
  }

  private count(acct: string, plugin: string): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM pdata WHERE acct = ? AND plugin = ? AND deleted = 0", acct, plugin).one().n;
  }

  /** 写一行: ver 必须等于当前 ver (不存在为 0); 内容没变不写库。 */
  put(acct: string, plugin: string, coll: string, id: string, ver: number, body: unknown, now = Date.now()): PutResult {
    const cur = this.row(acct, plugin, coll, id);
    if ((cur?.ver ?? 0) !== ver) return { conflict: cur ? toItem(cur) : null };
    const text = JSON.stringify(body);
    if (cur && !cur.deleted && cur.body === text) return { ok: toItem(cur) };
    if ((!cur || cur.deleted) && this.count(acct, plugin) >= MAX_PDATA_ROWS) return { error: `每个插件最多 ${MAX_PDATA_ROWS} 行数据` };
    const next: Row = { id, ver: ver + 1, rev: this.nextRev(acct, plugin), updated: now, deleted: 0, body: text };
    this.sql.exec("INSERT OR REPLACE INTO pdata (acct, plugin, coll, id, ver, rev, updated, deleted, body) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)", acct, plugin, coll, id, next.ver, next.rev, now, text);
    return { ok: toItem(next) };
  }

  /** 删除写墓碑, 同步方据此删本地副本。 */
  remove(acct: string, plugin: string, coll: string, id: string, ver: number, now = Date.now()): PutResult {
    const cur = this.row(acct, plugin, coll, id);
    if (!cur || cur.ver !== ver) return { conflict: cur ? toItem(cur) : null };
    if (cur.deleted) return { ok: toItem(cur) };
    const next: Row = { id, ver: ver + 1, rev: this.nextRev(acct, plugin), updated: now, deleted: 1, body: null };
    this.sql.exec("UPDATE pdata SET ver = ?, rev = ?, updated = ?, deleted = 1, body = NULL WHERE acct = ? AND plugin = ? AND coll = ? AND id = ?", next.ver, next.rev, now, acct, plugin, coll, id);
    return { ok: toItem(next) };
  }

  /** 卸载时选择彻底清除。 */
  purge(acct: string, plugin: string): number {
    return this.sql.exec("DELETE FROM pdata WHERE acct = ? AND plugin = ?", acct, plugin).rowsWritten;
  }
}
