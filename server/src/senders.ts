import type { Envelope, SenderMeta, SenderPatch } from "@hx-aioa/protocol";
import { SRC_SYSTEM } from "./constants";

// 服务端自己发言用的来源: system (聚合), system:* (各类通知), 终端审计
const SYSTEM_PREFIX = `${SRC_SYSTEM}:`;
const TERMINAL = "终端";
const ALIAS_MAX = 32;
const BACKFILL_KEY = "sender_backfill";

type Row = { sid: string; name: string; icon: string | null; alias: string | null; avatar: string | null; first: number; last: number; updated: number };

export const isSystemSender = (sid: string): boolean => sid === SRC_SYSTEM || sid.startsWith(SYSTEM_PREFIX) || sid === TERMINAL;

/** 群 Agent 等非真人来源 (#121): 来源 id 与当前名字, 主人也能给它们改名换头像。 */
export type AgentSource = { id: string; name: string; created?: number };

/**
 * 系统发送者登记表 (#128): 第一次发言自动登记, 之后只更新最近出现; 主人在这里改名, 换头像。
 * 旧表 sender_meta (#123, 只有头像) 并进来; 历史消息里的系统来源第一次启动时补登。
 */
export class SenderStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS sender (
      sid TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, alias TEXT, avatar TEXT,
      first INTEGER NOT NULL, last INTEGER NOT NULL, updated INTEGER NOT NULL
    )`);
    sql.exec("CREATE TABLE IF NOT EXISTS sender_flag (k TEXT PRIMARY KEY)");
    if (sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sender_meta'").toArray().length) {
      sql.exec("INSERT OR IGNORE INTO sender (sid, name, avatar, first, last, updated) SELECT sid, sid, avatar, updated, updated, updated FROM sender_meta");
      sql.exec("DROP TABLE sender_meta");
    }
  }

  /** 历史消息里出现过的系统来源补登一次 (按 ev 表; 名字图标取最近一条)。 */
  backfill(): void {
    if (this.sql.exec("SELECT k FROM sender_flag WHERE k = ?", BACKFILL_KEY).toArray().length) return;
    const sid = "json_extract(body, '$.source.id')";
    const rows = this.sql
      .exec<{ sid: string; name: string | null; icon: string | null; first: number; last: number }>(
        `SELECT ${sid} AS sid, json_extract(body, '$.source.name') AS name, json_extract(body, '$.source.icon') AS icon, MIN(ts) AS first, MAX(ts) AS last
         FROM ev WHERE ${sid} = ? OR ${sid} LIKE ? OR ${sid} = ? GROUP BY ${sid}`,
        SRC_SYSTEM, `${SYSTEM_PREFIX}%`, TERMINAL,
      )
      .toArray();
    for (const r of rows) {
      // 从 #123 旧表并过来的只有头像, 名字是 sid: 补上真名, 图标与出现时间
      this.sql.exec(
        `INSERT INTO sender (sid, name, icon, first, last, updated) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET name = CASE WHEN name = sid THEN excluded.name ELSE name END,
           icon = COALESCE(icon, excluded.icon), first = MIN(first, excluded.first), last = MAX(last, excluded.last)`,
        r.sid, r.name || r.sid, r.icon, r.first, r.last, r.last,
      );
    }
    this.sql.exec("INSERT OR IGNORE INTO sender_flag (k) VALUES (?)", BACKFILL_KEY);
  }

  list(): SenderMeta[] {
    return this.sql.exec<Row>("SELECT * FROM sender ORDER BY last DESC").toArray().map(toMeta);
  }

  get(sid: string): SenderMeta | null {
    const r = this.sql.exec<Row>("SELECT * FROM sender WHERE sid = ?", sid).toArray()[0];
    return r ? toMeta(r) : null;
  }

  /**
   * Agent 来源 (#121) 补登: 现有的 Agent 来源都登记, 默认名跟着来源走, 别名与头像不动 (#123 旧表并过来的头像也留着);
   * 来源删掉了的行留着不删, 免得丢主人设过的头像。列表与改名前调用, 这样没发过言的群 Agent 也能先设好头像。
   */
  syncAgents(agents: AgentSource[], now = Date.now()): void {
    for (const a of agents) {
      this.sql.exec(
        `INSERT INTO sender (sid, name, first, last, updated) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET name = excluded.name WHERE name <> excluded.name`,
        a.id, a.name || a.id, a.created ?? now, a.created ?? now, now,
      );
    }
  }

  /** 发消息前调用: 系统来源与 Agent 来源 (agent) 登记 / 更新最近出现; 主人改过名的换成别名。返回要存的信封。 */
  see(ev: Envelope, now = Date.now(), agent = false): Envelope {
    const src = ev.source;
    if (!src?.id || !(agent || isSystemSender(src.id))) return ev;
    const cur = this.get(src.id);
    if (!cur) {
      this.sql.exec("INSERT INTO sender (sid, name, icon, first, last, updated) VALUES (?, ?, ?, ?, ?, ?)", src.id, src.name || src.id, src.icon ?? null, now, now, now);
      return ev;
    }
    // 默认名 / 图标跟着代码走 (改过名的不动别名)
    const name = cur.alias ? cur.name : src.name || cur.name;
    this.sql.exec("UPDATE sender SET name = ?, icon = COALESCE(?, icon), last = MAX(last, ?) WHERE sid = ?", name, src.icon ?? null, now, src.id);
    return cur.alias ? { ...ev, source: { ...src, name: cur.alias } } : ev;
  }

  /** 主人改别名 / 头像; null 或空串清掉。返回改后的, 没登记过的为 null。 */
  patch(sid: string, p: SenderPatch, now = Date.now()): SenderMeta | null | string {
    const cur = this.get(sid);
    if (!cur) return null;
    const alias = p.alias === undefined ? cur.alias : p.alias?.trim() || undefined;
    if (alias && alias.length > ALIAS_MAX) return `名字最多 ${ALIAS_MAX} 字`;
    const avatar = p.avatar === undefined ? cur.avatar : p.avatar || undefined;
    this.sql.exec("UPDATE sender SET alias = ?, avatar = ?, updated = ? WHERE sid = ?", alias ?? null, avatar ?? null, now, sid);
    return this.get(sid);
  }
}

function toMeta(r: Row): SenderMeta {
  return {
    sid: r.sid,
    name: r.name,
    ...(r.icon ? { icon: r.icon } : {}),
    ...(r.alias ? { alias: r.alias } : {}),
    ...(r.avatar ? { avatar: r.avatar } : {}),
    first: r.first,
    last: r.last,
    updated: r.updated,
  };
}
