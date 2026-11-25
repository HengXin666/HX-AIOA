import { GH_MAX_OPS, type GhAuth, type GhOp, type GhRules } from "@hx-aioa/protocol";

// 存库的授权: token / refresh 都是密文
export type GhSecret = GhAuth & { token: string; refresh?: string; refreshExpires?: number };
type Row = { v: string };
const K_AUTH = "auth";
const K_RULES = "rules";
const K_GRANTS = "grants";
const K_OPS = "ops";

/** GitHub 授权的全部状态, 存在一张小 kv 表里。 */
export class GhStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS gh (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  private get<T>(k: string): T | null {
    const r = this.sql.exec<Row>("SELECT v FROM gh WHERE k = ?", k).toArray()[0];
    return r ? (JSON.parse(r.v) as T) : null;
  }

  private put(k: string, v: unknown): void {
    this.sql.exec("INSERT OR REPLACE INTO gh (k, v) VALUES (?, ?)", k, JSON.stringify(v));
  }

  secret(): GhSecret | null {
    return this.get<GhSecret>(K_AUTH);
  }

  setSecret(s: GhSecret | null): void {
    if (s) this.put(K_AUTH, s);
    else this.sql.exec("DELETE FROM gh WHERE k = ?", K_AUTH);
  }

  rules(): GhRules {
    return this.get<GhRules>(K_RULES) ?? {};
  }

  setRules(r: GhRules): void {
    this.put(K_RULES, r);
  }

  // 主人对每把 key 的明确开关; 没设过的按 "插件声明了依赖就默认开"
  grants(): Record<string, boolean> {
    return this.get<Record<string, boolean>>(K_GRANTS) ?? {};
  }

  setGrant(keyId: string, on: boolean): void {
    this.put(K_GRANTS, { ...this.grants(), [keyId]: on });
  }

  ops(): GhOp[] {
    return this.get<GhOp[]>(K_OPS) ?? [];
  }

  log(op: GhOp): void {
    this.put(K_OPS, [op, ...this.ops()].slice(0, GH_MAX_OPS));
  }
}
