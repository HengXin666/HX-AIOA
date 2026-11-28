import { AG_DONE_TTL_MS, AG_OPEN_TTL_MS, type AgCard } from "@hx-aioa/protocol";

export const AG_OPEN = "open";
export const AG_DONE = "done";

export type AgReqRow = { host: string; rid: string; sid: string; card: string; state: string; by: string | null; at: number; done_at: number | null; loud: number };
// new: 第一次见; update: 还没答, 探针重发 (如 quiet 变假); done: 已答 / 已撤回, 不再推
export type AgPutResult = { kind: "new" | "update" | "done"; loudBefore: boolean };

/** Agent GUI 待审批卡片: 每个权限请求一行, 答复 / 撤回置 done; at 用 Hub 收到的时间, 免得受主机时钟影响清理。 */
export class AgentGuiStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS agent_gui_req (
      host TEXT NOT NULL, rid TEXT NOT NULL, sid TEXT NOT NULL, card TEXT NOT NULL, state TEXT NOT NULL,
      "by" TEXT, at INTEGER NOT NULL, done_at INTEGER, loud INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (host, rid)
    )`);
  }

  get(host: string, rid: string): AgReqRow | undefined {
    return this.sql.exec<AgReqRow>("SELECT * FROM agent_gui_req WHERE host = ? AND rid = ?", host, rid).toArray()[0];
  }

  /** 存卡片; loud = 这次会发正常 (有声) 推送, 与卡片同一次写记下, 之后的重发不再推。 */
  put(card: AgCard, now = Date.now(), loud = false): AgPutResult {
    const cur = this.get(card.host, card.rid);
    if (cur?.state === AG_DONE) return { kind: "done", loudBefore: cur.loud === 1 };
    const body = JSON.stringify(card);
    const l = loud ? 1 : 0;
    if (cur) {
      this.sql.exec("UPDATE agent_gui_req SET card = ?, sid = ?, loud = MAX(loud, ?) WHERE host = ? AND rid = ?", body, card.sid, l, card.host, card.rid);
      return { kind: "update", loudBefore: cur.loud === 1 };
    }
    this.sql.exec("INSERT INTO agent_gui_req (host, rid, sid, card, state, at, loud) VALUES (?, ?, ?, ?, ?, ?, ?)", card.host, card.rid, card.sid, body, AG_OPEN, now, l);
    return { kind: "new", loudBefore: false };
  }

  /** 先答先得: 只有还 open 的那一次返回 true。 */
  done(host: string, rid: string, by: string, now = Date.now()): boolean {
    return this.sql.exec(`UPDATE agent_gui_req SET state = ?, "by" = ?, done_at = ? WHERE host = ? AND rid = ? AND state = ?`, AG_DONE, by, now, host, rid, AG_OPEN).rowsWritten > 0;
  }

  /** 已 done 的行改正答复者 (探针说实际是别人答的 / Agent 取消了); by 没变返回 false。 */
  setBy(host: string, rid: string, by: string): boolean {
    return this.sql.exec(`UPDATE agent_gui_req SET "by" = ? WHERE host = ? AND rid = ? AND state = ? AND ("by" IS NULL OR "by" != ?)`, by, host, rid, AG_DONE, by).rowsWritten > 0;
  }

  open(): AgCard[] {
    return this.sql.exec<{ card: string }>("SELECT card FROM agent_gui_req WHERE state = ? ORDER BY at ASC", AG_OPEN).toArray().map((r) => JSON.parse(r.card) as AgCard);
  }

  openOf(host: string): AgReqRow[] {
    return this.sql.exec<AgReqRow>("SELECT * FROM agent_gui_req WHERE host = ? AND state = ?", host, AG_OPEN).toArray();
  }

  /** 答复 / 撤回 24 小时后删, 没人答的 7 天后删; 返回删掉的行数。 */
  sweep(now = Date.now()): number {
    const a = this.sql.exec("DELETE FROM agent_gui_req WHERE state = ? AND done_at < ?", AG_DONE, now - AG_DONE_TTL_MS).rowsWritten;
    const b = this.sql.exec("DELETE FROM agent_gui_req WHERE state = ? AND at < ?", AG_OPEN, now - AG_OPEN_TTL_MS).rowsWritten;
    return a + b;
  }
}
