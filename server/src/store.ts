import type { Body, MsgFrame } from "@hx-aioa/protocol";

type Row = {
  seq: number;
  ts: number;
  src: string;
  cid: string | null;
  body: string;
};

// 每条消息只写一行, 免费额度的瓶颈是每天 10 万行写入
export class MessageStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      `CREATE TABLE IF NOT EXISTS msg (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        src TEXT NOT NULL,
        cid TEXT,
        body TEXT NOT NULL
      )`,
    );
  }

  append(src: string, body: Body, cid: string | undefined, ts: number): number {
    const row = this.sql
      .exec<{ seq: number }>(
        "INSERT INTO msg (ts, src, cid, body) VALUES (?, ?, ?, ?) RETURNING seq",
        ts,
        src,
        cid ?? null,
        JSON.stringify(body),
      )
      .one();
    return row.seq;
  }

  head(): number {
    const row = this.sql.exec<{ head: number | null }>("SELECT MAX(seq) AS head FROM msg").one();
    return row.head ?? 0;
  }

  since(seq: number, limit: number): MsgFrame[] {
    const rows = this.sql
      .exec<Row>(
        "SELECT seq, ts, src, cid, body FROM msg WHERE seq > ? ORDER BY seq LIMIT ?",
        seq,
        limit,
      )
      .toArray();
    return rows.map(toFrame);
  }
}

function toFrame(row: Row): MsgFrame {
  const frame: MsgFrame = {
    t: "msg",
    seq: row.seq,
    ts: row.ts,
    src: row.src,
    body: JSON.parse(row.body) as Body,
  };
  if (row.cid) frame.cid = row.cid;
  return frame;
}
