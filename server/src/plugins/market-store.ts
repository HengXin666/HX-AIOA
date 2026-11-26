import type { MarketSource } from "@hx-aioa/protocol";

type SrcRow = { id: string; body: string };
type CacheRow = { v: string; at: number };
// 缓存行数上限: 超了删最早的一批, 免得旧版本的介绍和提示词一直占库
const MAX_ROWS = 300;
const PRUNE = 50;

/** 管理员加的市场源 (官方源不落库) 和市场内容缓存 (索引按源, 文件按版本)。 */
export class MarketStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS plugin_source (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS market_cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  sources(): MarketSource[] {
    return this.sql.exec<SrcRow>("SELECT id, body FROM plugin_source").toArray().map((r) => JSON.parse(r.body) as MarketSource).sort((a, b) => a.added - b.added);
  }

  putSource(s: MarketSource): void {
    this.sql.exec("INSERT OR REPLACE INTO plugin_source (id, body) VALUES (?, ?)", s.id, JSON.stringify({ id: s.id, name: s.name, url: s.url, link: s.link, added: s.added }));
  }

  dropSource(id: string): boolean {
    const n = this.sql.exec("DELETE FROM plugin_source WHERE id = ?", id).rowsWritten;
    this.sql.exec("DELETE FROM market_cache WHERE k = ? OR k LIKE ?", `idx:${id}`, `f:${id}:%`);
    return n > 0;
  }

  get(k: string): CacheRow | null {
    return this.sql.exec<CacheRow>("SELECT v, at FROM market_cache WHERE k = ?", k).toArray()[0] ?? null;
  }

  put(k: string, v: string, at: number): void {
    this.sql.exec("INSERT OR REPLACE INTO market_cache (k, v, at) VALUES (?, ?, ?)", k, v, at);
    const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM market_cache").one().n;
    if (n > MAX_ROWS) this.sql.exec("DELETE FROM market_cache WHERE k IN (SELECT k FROM market_cache ORDER BY at LIMIT ?)", PRUNE);
  }
}
