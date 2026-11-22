import { KEY_PREFIX, type KeyInfo, type KeyRequest, type Scope, type SourceInfo, type SourceInput } from "@hx-aioa/protocol";
import { hmac, randomId, randomSecret, sha256 } from "./auth";
import { DEFAULT_RATE_PER_MIN, KEY_PREFIX_SHOWN, OWNER_ID, WEBHOOK_SECRET_PREFIX } from "./constants";

type KeyRow = { id: string; hash: string; body: string };
type SourceRow = { id: string; body: string };

// 接入 key 与来源注册表; 多账号 (#5) 落地后迁到目录 DO, 结构不变
export class Registry {
  private readonly rate = new Map<string, { minute: number; count: number }>();

  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS apikey (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS source (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  }

  async createKey(req: KeyRequest): Promise<{ info: KeyInfo; key: string }> {
    const key = randomSecret(KEY_PREFIX);
    const info: KeyInfo = {
      id: randomId("k_"),
      userId: OWNER_ID,
      name: req.name,
      prefix: key.slice(0, KEY_PREFIX_SHOWN),
      scopes: req.scopes,
      channels: req.channels ?? [],
      ratePerMin: req.ratePerMin ?? DEFAULT_RATE_PER_MIN,
      created: Date.now(),
    };
    if (req.sourceId) info.sourceId = req.sourceId;
    if (req.subject) info.subject = req.subject;
    this.sql.exec("INSERT INTO apikey (id, hash, body) VALUES (?, ?, ?)", info.id, await sha256(key), JSON.stringify(info));
    return { info, key };
  }

  async keyBySecret(key: string): Promise<KeyInfo | null> {
    if (!key.startsWith(KEY_PREFIX)) return null;
    const row = this.sql.exec<KeyRow>("SELECT id, hash, body FROM apikey WHERE hash = ?", await sha256(key)).toArray()[0];
    return row ? (JSON.parse(row.body) as KeyInfo) : null;
  }

  key(id: string): KeyInfo | null {
    const row = this.sql.exec<KeyRow>("SELECT id, hash, body FROM apikey WHERE id = ?", id).toArray()[0];
    return row ? (JSON.parse(row.body) as KeyInfo) : null;
  }

  keys(): KeyInfo[] {
    return this.sql.exec<KeyRow>("SELECT id, hash, body FROM apikey ORDER BY id").toArray().map((r) => JSON.parse(r.body) as KeyInfo);
  }

  deleteKey(id: string): boolean {
    return this.sql.exec("DELETE FROM apikey WHERE id = ?", id).rowsWritten > 0;
  }

  // webhook 签名密钥由服务端 secret 派生, 不落库
  static webhookSecret(tokenSecret: string, keyId: string): Promise<string> {
    return hmac(tokenSecret, `webhook:${keyId}`).then((h) => WEBHOOK_SECRET_PREFIX + h.slice(0, 40));
  }

  // 内存计数的每分钟限速, 休眠后清零可以接受
  allow(key: KeyInfo, now = Date.now()): boolean {
    const minute = Math.floor(now / 60_000);
    const cur = this.rate.get(key.id);
    if (!cur || cur.minute !== minute) {
      this.rate.set(key.id, { minute, count: 1 });
      return true;
    }
    cur.count += 1;
    return cur.count <= key.ratePerMin;
  }

  createSource(input: SourceInput): SourceInfo {
    const { key: _key, ...rest } = input;
    const info: SourceInfo = { ...rest, id: randomId("src_"), userId: OWNER_ID, rules: undefined, created: Date.now() };
    if (input.rules) info.rules = input.rules.map((r, i) => ({ ...r, id: `${info.id}:${i}` }));
    else delete info.rules;
    this.saveSource(info);
    return info;
  }

  saveSource(info: SourceInfo): void {
    this.sql.exec("INSERT OR REPLACE INTO source (id, body) VALUES (?, ?)", info.id, JSON.stringify(info));
  }

  source(id: string): SourceInfo | null {
    const row = this.sql.exec<SourceRow>("SELECT id, body FROM source WHERE id = ?", id).toArray()[0];
    return row ? (JSON.parse(row.body) as SourceInfo) : null;
  }

  sources(): SourceInfo[] {
    return this.sql.exec<SourceRow>("SELECT id, body FROM source ORDER BY id").toArray().map((r) => JSON.parse(r.body) as SourceInfo);
  }

  // 来源删除后其绑定的 key 一并作废, 否则 webhook 仍能以默认来源写入
  deleteSource(id: string): boolean {
    for (const k of this.keys()) if (k.sourceId === id) this.deleteKey(k.id);
    return this.sql.exec("DELETE FROM source WHERE id = ?", id).rowsWritten > 0;
  }
}

export function hasScope(key: KeyInfo, scope: Scope): boolean {
  return key.scopes.includes(scope);
}
