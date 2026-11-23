import type { Envelope, Kind } from "@hx-aioa/protocol";
import { DEVICE_PREFIX, MEMO_GROUP } from "./constants";
import { legacyBodyText, textToEventData } from "./legacy";

type Row = { seq: number; body: string };

const COLS = "seq, body";
const META_FLOOR = "floor";
// 只在一次性回填旧行时用; 新行在写入时用 groupOf 算好存进 grp 列
const GROUP_KEY = `COALESCE(NULLIF(json_extract(body, '$.channel'), ''), CASE WHEN json_extract(body, '$.source.id') LIKE '${DEVICE_PREFIX}%' THEN '${MEMO_GROUP}' ELSE COALESCE(NULLIF(json_extract(body, '$.source.name'), ''), json_extract(body, '$.source.id')) END)`;

// 收件箱: 每条事件一行; 覆盖更新 = 删旧行 + 插新行 (id 不变, seq 变新), 便于客户端按 since 补拉
export class EventStore {
  constructor(
    private readonly sql: SqlStorage,
    tx: (fn: () => void) => void,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS ev (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      dedupe TEXT,
      body TEXT NOT NULL
    )`);
    sql.exec("CREATE TABLE IF NOT EXISTS ev_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS ev_dedupe ON ev (dedupe) WHERE dedupe IS NOT NULL");
    tx(() => this.addColumns());
    if (sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'msg'").toArray().length) {
      tx(() => this.migrateLegacy());
    }
  }

  // grp: 所属群, 指标为空; gone: 墓碑时间。都有索引, 按群翻页和清墓碑不再全表扫描
  private addColumns(): void {
    const cols = this.sql.exec<{ name: string }>("PRAGMA table_info(ev)").toArray().map((c) => c.name);
    if (!cols.includes("grp")) {
      this.sql.exec("ALTER TABLE ev ADD COLUMN grp TEXT");
      this.sql.exec("ALTER TABLE ev ADD COLUMN gone INTEGER");
      this.sql.exec(`UPDATE ev SET grp = CASE WHEN kind = 'metric' THEN NULL ELSE ${GROUP_KEY} END, gone = json_extract(body, '$.deleted.at')`);
    }
    this.sql.exec("CREATE INDEX IF NOT EXISTS ev_grp ON ev (grp, seq) WHERE grp IS NOT NULL");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ev_gone ON ev (gone) WHERE gone IS NOT NULL");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ev_kind ON ev (kind, seq)");
  }

  // 一次性把旧 msg 表并入 ev, 保留原 seq, 旧客户端补拉不断档
  private migrateLegacy(): void {
    const rows = this.sql.exec<{ seq: number; ts: number; src: string; cid: string | null; body: string }>("SELECT seq, ts, src, cid, body FROM msg ORDER BY seq").toArray();
    for (const r of rows) {
      const ev: Envelope = {
        id: `m_${r.seq}`,
        seq: r.seq,
        ts: r.ts,
        kind: "event",
        source: { id: r.src, name: r.src },
        priority: "happening",
        data: textToEventData(legacyBodyText(r.body)),
      };
      if (r.cid) ev.cid = r.cid;
      this.sql.exec("INSERT INTO ev (seq, id, ts, kind, dedupe, body, grp) VALUES (?, ?, ?, ?, NULL, ?, ?)", r.seq, ev.id, ev.ts, ev.kind, strip(ev), groupOf(ev));
    }
    this.sql.exec("DROP TABLE msg");
  }

  static dedupeOf(ev: Pick<Envelope, "source" | "dedupeKey">): string | null {
    return ev.dedupeKey ? `${ev.source.id}|${ev.dedupeKey}` : null;
  }

  put(ev: Envelope): Envelope {
    this.sql.exec("DELETE FROM ev WHERE id = ?", ev.id);
    const row = this.sql
      .exec<{ seq: number }>(
        "INSERT INTO ev (id, ts, kind, dedupe, body, grp, gone) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING seq",
        ev.id,
        ev.ts,
        ev.kind,
        EventStore.dedupeOf(ev),
        strip(ev),
        groupOf(ev),
        ev.deleted?.at ?? null,
      )
      .one();
    return { ...ev, seq: row.seq };
  }

  get(id: string): Envelope | null {
    return first(this.sql.exec<Row>(`SELECT ${COLS} FROM ev WHERE id = ?`, id).toArray());
  }

  // 某个群 (channel) 的消息, 给 Agent 读群用; 指标不算消息
  inChannel(channel: string, since: number, limit: number): Envelope[] {
    return this.sql
      .exec<Row>(`SELECT ${COLS} FROM ev WHERE grp = ? AND seq > ? ORDER BY seq LIMIT ?`, channel, since, limit)
      .toArray()
      .map(parse);
  }

  // 清空一个群 seq < before 的消息 (指标不算), 返回删掉的条数
  clearGroup(key: string, before: number): number {
    return this.sql.exec("DELETE FROM ev WHERE grp = ? AND seq < ?", key, before).rowsWritten;
  }

  // 群里 before 之前的一页 (升序), 客户端本地翻到头后向云端要更早的
  groupBefore(key: string, before: number, limit: number): Envelope[] {
    return this.sql
      .exec<Row>(`SELECT ${COLS} FROM ev WHERE grp = ? AND seq < ? ORDER BY seq DESC LIMIT ?`, key, before, limit)
      .toArray()
      .map(parse)
      .reverse();
  }

  // 清掉过期墓碑; floor 记下被清掉的最大 seq, since 早于它的设备需要整体重拉
  pruneTombstones(cutoff: number): number {
    const r = this.sql.exec<{ m: number | null }>("SELECT MAX(seq) AS m FROM ev WHERE gone < ?", cutoff).one();
    if (!r.m) return 0;
    const n = this.sql.exec("DELETE FROM ev WHERE gone < ?", cutoff).rowsWritten;
    this.sql.exec("INSERT INTO ev_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = MAX(v, excluded.v)", META_FLOOR, r.m);
    return n;
  }

  floor(): number {
    return this.sql.exec<{ v: number }>("SELECT v FROM ev_meta WHERE k = ?", META_FLOOR).toArray()[0]?.v ?? 0;
  }

  bySeq(seq: number): Envelope | null {
    return first(this.sql.exec<Row>(`SELECT ${COLS} FROM ev WHERE seq = ?`, seq).toArray());
  }

  byDedupe(key: string): Envelope | null {
    return first(this.sql.exec<Row>(`SELECT ${COLS} FROM ev WHERE dedupe = ? ORDER BY seq DESC LIMIT 1`, key).toArray());
  }

  since(seq: number, limit: number, kind?: Kind): Envelope[] {
    const rows = kind
      ? this.sql.exec<Row>(`SELECT ${COLS} FROM ev WHERE seq > ? AND kind = ? ORDER BY seq LIMIT ?`, seq, kind, limit)
      : this.sql.exec<Row>(`SELECT ${COLS} FROM ev WHERE seq > ? ORDER BY seq LIMIT ?`, seq, limit);
    return rows.toArray().map(parse);
  }

  // 子号补拉: 只要自己所在群的; 按 seq 范围扫增量再按 grp 过滤
  sinceIn(grps: string[], seq: number, limit: number): Envelope[] {
    if (!grps.length) return [];
    const marks = grps.map(() => "?").join(", ");
    return this.sql.exec<Row>(`SELECT ${COLS} FROM ev WHERE seq > ? AND grp IN (${marks}) ORDER BY seq LIMIT ?`, seq, ...grps, limit).toArray().map(parse);
  }

  recentIn(grps: string[], n: number): Envelope[] {
    if (!grps.length) return [];
    const marks = grps.map(() => "?").join(", ");
    return this.sql.exec<Row>(`SELECT ${COLS} FROM ev WHERE grp IN (${marks}) ORDER BY seq DESC LIMIT ?`, ...grps, n).toArray().map(parse).reverse();
  }

  before(seq: number, limit: number, kind: Kind): Envelope[] {
    return this.sql.exec<Row>(`SELECT ${COLS} FROM ev WHERE seq < ? AND kind = ? ORDER BY seq DESC LIMIT ?`, seq, kind, limit).toArray().map(parse);
  }

  // 最近 n 条 (按 seq 升序), 供聚合与根因判断
  recent(n: number): Envelope[] {
    return this.sql.exec<Row>(`SELECT ${COLS} FROM ev ORDER BY seq DESC LIMIT ?`, n).toArray().map(parse).reverse();
  }

  head(): number {
    return this.sql.exec<{ head: number | null }>("SELECT MAX(seq) AS head FROM ev").one().head ?? 0;
  }
}

/** 事件所属的群: 有 channel 用 channel, 客户端自己发的进备忘, 否则按来源; 指标不属于任何群。 */
export function groupOf(ev: Envelope): string | null {
  if (ev.kind === "metric") return null;
  if (ev.channel) return ev.channel;
  if (ev.source.id.startsWith(DEVICE_PREFIX)) return MEMO_GROUP;
  return ev.source.name || ev.source.id;
}

function strip(ev: Envelope): string {
  const { seq: _seq, ...rest } = ev;
  return JSON.stringify(rest);
}

function parse(row: Row): Envelope {
  return { ...(JSON.parse(row.body) as Envelope), seq: row.seq };
}

function first(rows: Row[]): Envelope | null {
  const r = rows[0];
  return r ? parse(r) : null;
}
