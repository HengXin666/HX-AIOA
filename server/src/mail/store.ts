import type { MailFacet, MailFacets } from "@hx-aioa/protocol";

type IdRow = { ev: string };
type FacetRow = { k: string; n: number; m: number };
export type MailRow = { ev: string; ts: number; account: string; vendor: string; frm: string };
export type MailQuery = { vendor?: string; account?: string; before?: number; limit: number };

// 只有消息还在 (没被删 / 清空) 的信才算数; ev.id 唯一索引, 联表很便宜
const ALIVE = "JOIN ev e ON e.id = m.ev AND e.gone IS NULL";

/** 邮件索引: 一封信一行, 厂商 / 账号 / 时间都有索引, 筛选不扫 JSON。 */
export class MailStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS mail (
      ev TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      account TEXT NOT NULL,
      vendor TEXT NOT NULL,
      frm TEXT NOT NULL
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS mail_ts ON mail (ts)");
    sql.exec("CREATE INDEX IF NOT EXISTS mail_vendor ON mail (vendor, ts)");
    sql.exec("CREATE INDEX IF NOT EXISTS mail_account ON mail (account, ts)");
  }

  add(r: MailRow): void {
    this.sql.exec("INSERT OR REPLACE INTO mail (ev, ts, account, vendor, frm) VALUES (?, ?, ?, ?, ?)", r.ev, r.ts, r.account, r.vendor, r.frm);
  }

  /** 按时间倒序的事件 id; 多取一条用来判断还有没有更早的。 */
  list(q: MailQuery): string[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.vendor) (where.push("m.vendor = ?"), args.push(q.vendor));
    if (q.account) (where.push("m.account = ?"), args.push(q.account));
    if (q.before) (where.push("m.ts < ?"), args.push(q.before));
    const cond = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.sql
      .exec<IdRow>(`SELECT m.ev FROM mail m ${ALIVE} ${cond} ORDER BY m.ts DESC LIMIT ?`, ...args, q.limit + 1)
      .toArray()
      .map((r) => r.ev);
  }

  facets(): MailFacets {
    return { vendors: this.facet("vendor"), accounts: this.facet("account") };
  }

  private facet(col: "vendor" | "account"): MailFacet[] {
    return this.sql
      .exec<FacetRow>(`SELECT m.${col} AS k, COUNT(*) AS n, MAX(m.ts) AS m FROM mail m ${ALIVE} GROUP BY m.${col} ORDER BY m DESC`)
      .toArray()
      .map((r) => ({ key: r.k, count: r.n, last: r.m }));
  }

  /** 消息已被删掉的索引行, 每天随文件清理一起扫。 */
  prune(): number {
    return this.sql.exec("DELETE FROM mail WHERE ev NOT IN (SELECT id FROM ev WHERE gone IS NULL)").rowsWritten;
  }
}
