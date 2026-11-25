// 译文缓存 (按 语言 + 格式 + 原文 的哈希) 与每月计费字符数
const CACHE_KEEP_MS = 90 * 86_400_000;
// 写入这么多条后顺手清一次过期缓存
const PRUNE_EVERY = 200;

export const monthOf = (ts: number) => new Date(ts).toISOString().slice(0, 7);

export async function cacheKey(to: string, format: string, text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${to}\n${format}\n${text}`));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class TranslateStore {
  private writes = 0;

  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS tr_cache (h TEXT PRIMARY KEY, out TEXT NOT NULL, src TEXT NOT NULL, ts INTEGER NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS tr_cache_ts ON tr_cache (ts)");
    sql.exec("CREATE TABLE IF NOT EXISTS tr_usage (month TEXT PRIMARY KEY, chars INTEGER NOT NULL)");
  }

  get(h: string): { out: string; src: string } | undefined {
    return this.sql.exec<{ out: string; src: string }>("SELECT out, src FROM tr_cache WHERE h = ?", h).toArray()[0];
  }

  put(h: string, out: string, src: string, now: number): void {
    this.sql.exec("INSERT OR REPLACE INTO tr_cache (h, out, src, ts) VALUES (?, ?, ?, ?)", h, out, src, now);
    if (++this.writes % PRUNE_EVERY === 0) this.sql.exec("DELETE FROM tr_cache WHERE ts < ?", now - CACHE_KEEP_MS);
  }

  used(month: string): number {
    return this.sql.exec<{ chars: number }>("SELECT chars FROM tr_usage WHERE month = ?", month).toArray()[0]?.chars ?? 0;
  }

  bill(month: string, chars: number): void {
    this.sql.exec("INSERT INTO tr_usage (month, chars) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET chars = chars + excluded.chars", month, chars);
  }
}
