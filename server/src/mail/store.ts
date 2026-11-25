import { categoryOf, isRelayAddress, MAIL_ACCOUNT_UNKNOWN, type MailFacet, type MailFacets } from "@hx-aioa/protocol";

type IdRow = { ev: string };
type FacetRow = { k: string; n: number; m: number; f: string };
export type MailRow = { ev: string; ts: number; account: string; vendor: string; frm: string; subj: string; cat: string };
export type MailQuery = { vendor?: string; account?: string; category?: string; before?: number; q?: string; limit: number };
type FacetCol = "vendor" | "account" | "cat";

// 统计结果缓存: 新信到达立即失效, 删信靠过期兜底
const FACET_TTL_MS = 60_000;
const FWD_KEEP_MS = 30 * 86_400_000;
const LIKE_ESCAPE = "\\";
const likeOf = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => LIKE_ESCAPE + c)}%`;

// 只有消息还在 (没被删 / 清空) 的信才算数; ev.id 唯一索引, 联表很便宜
const ALIVE = "JOIN ev e ON e.id = m.ev AND e.gone IS NULL";

/** 邮件索引: 一封信一行, 厂商 / 账号 / 时间都有索引, 筛选不扫 JSON。 */
export class MailStore {
  private cache: { at: number; v: MailFacets } | null = null;

  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS mail (
      ev TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      account TEXT NOT NULL,
      vendor TEXT NOT NULL,
      frm TEXT NOT NULL
    )`);
    // 后加的列: 主题 (小写, 只用于关键词搜索), 分类 (加列时按发件人补上旧信)
    const cols = sql.exec<{ name: string }>("PRAGMA table_info(mail)").toArray().map((c) => c.name);
    if (!cols.includes("subj")) sql.exec("ALTER TABLE mail ADD COLUMN subj TEXT");
    if (!cols.includes("cat")) {
      sql.exec("ALTER TABLE mail ADD COLUMN cat TEXT");
      for (const r of sql.exec<{ ev: string; frm: string }>("SELECT ev, frm FROM mail").toArray()) sql.exec("UPDATE mail SET cat = ? WHERE ev = ?", categoryOf(r.frm), r.ev);
    }
    // 旧版把信头 To 的中转地址 (repo@noreply.github.com) 当账号, 真实地址已无从还原, 归为未知
    for (const r of sql.exec<{ account: string }>("SELECT DISTINCT account FROM mail").toArray()) {
      if (isRelayAddress(r.account)) sql.exec("UPDATE mail SET account = ? WHERE account = ?", MAIL_ACCOUNT_UNKNOWN, r.account);
    }
    // 显示偏好与转发规则: 键值 JSON, 读多写少, 内存缓存
    sql.exec("CREATE TABLE IF NOT EXISTS mail_conf (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    // 规则转发过的信 (按去重键): 重投时不再转, 转完删掉的也不会复活; 保留 30 天
    sql.exec("CREATE TABLE IF NOT EXISTS mail_fwd (dedupe TEXT PRIMARY KEY, ts INTEGER NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS mail_ts ON mail (ts)");
    sql.exec("CREATE INDEX IF NOT EXISTS mail_cat ON mail (cat, ts)");
    sql.exec("CREATE INDEX IF NOT EXISTS mail_vendor ON mail (vendor, ts)");
    sql.exec("CREATE INDEX IF NOT EXISTS mail_account ON mail (account, ts)");
  }

  add(r: MailRow): void {
    this.sql.exec("INSERT OR REPLACE INTO mail (ev, ts, account, vendor, frm, subj, cat) VALUES (?, ?, ?, ?, ?, ?, ?)", r.ev, r.ts, r.account, r.vendor, r.frm, r.subj.toLowerCase(), r.cat);
    this.cache = null;
  }

  private conf = new Map<string, unknown>();

  /** 读设置, 没有时给默认值。 */
  getConf<T>(k: string, fallback: T): T {
    if (!this.conf.has(k)) {
      const row = this.sql.exec<{ v: string }>("SELECT v FROM mail_conf WHERE k = ?", k).toArray()[0];
      this.conf.set(k, row ? JSON.parse(row.v) : fallback);
    }
    return this.conf.get(k) as T;
  }

  setConf(k: string, v: unknown): void {
    this.sql.exec("INSERT OR REPLACE INTO mail_conf (k, v) VALUES (?, ?)", k, JSON.stringify(v));
    this.conf.set(k, v);
  }

  forwarded(dedupe: string): boolean {
    return this.sql.exec("SELECT 1 FROM mail_fwd WHERE dedupe = ?", dedupe).toArray().length > 0;
  }

  markForwarded(dedupe: string, now = Date.now()): void {
    this.sql.exec("INSERT OR REPLACE INTO mail_fwd (dedupe, ts) VALUES (?, ?)", dedupe, now);
  }

  /** 按时间倒序的事件 id; 多取一条用来判断还有没有更早的。 */
  list(q: MailQuery): string[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.vendor) (where.push("m.vendor = ?"), args.push(q.vendor));
    if (q.account !== undefined) (where.push("m.account = ?"), args.push(q.account));
    if (q.category) (where.push("m.cat = ?"), args.push(q.category));
    if (q.before) (where.push("m.ts < ?"), args.push(q.before));
    // 关键词只扫索引表 (短字段), 不碰消息正文
    if (q.q) (where.push(`(m.subj LIKE ? ESCAPE '${LIKE_ESCAPE}' OR m.frm LIKE ? ESCAPE '${LIKE_ESCAPE}')`), args.push(likeOf(q.q), likeOf(q.q)));
    const cond = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.sql
      .exec<IdRow>(`SELECT m.ev FROM mail m ${ALIVE} ${cond} ORDER BY m.ts DESC LIMIT ?`, ...args, q.limit + 1)
      .toArray()
      .map((r) => r.ev);
  }

  facets(now = Date.now()): MailFacets {
    if (this.cache && now - this.cache.at < FACET_TTL_MS) return this.cache.v;
    const v = { vendors: this.facet("vendor"), accounts: this.facet("account"), categories: this.facet("cat") };
    this.cache = { at: now, v };
    return v;
  }

  private facet(col: FacetCol): MailFacet[] {
    return this.sql
      .exec<FacetRow>(`SELECT m.${col} AS k, COUNT(*) AS n, MAX(m.ts) AS m, m.frm AS f FROM mail m ${ALIVE} GROUP BY m.${col} ORDER BY m DESC`)
      .toArray()
      .map((r) => ({ key: r.k, count: r.n, last: r.m, from: r.f }));
  }

  /** 消息已被删掉的索引行, 每天扫一次; 按 ev.id 逐行查, 不扫整张消息表。 */
  prune(): number {
    this.sql.exec("DELETE FROM mail_fwd WHERE ts < ?", Date.now() - FWD_KEEP_MS);
    const n = this.sql.exec("DELETE FROM mail WHERE NOT EXISTS (SELECT 1 FROM ev e WHERE e.id = mail.ev AND e.gone IS NULL)").rowsWritten;
    if (n) this.cache = null;
    return n;
  }
}
