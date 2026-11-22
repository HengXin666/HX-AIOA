import type { AgentInfo, TaskLogEntry, TaskSnapshot, UserAction } from "@hx-aioa/protocol";

export type ActState = "queued" | "delivered" | "acked";
export type AgentRow = { info: AgentInfo; keyId: string | null; seen: number; mode: "ws" | "http" };
type Body = { body: string };

// Agent, 任务, 对话历史, 用户动作队列的持久化; 进度这类瞬时状态由调用方节流后再写
export class TaskStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS task (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated INTEGER NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS task_log (n INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS task_log_task ON task_log (task_id)");
    sql.exec("CREATE TABLE IF NOT EXISTS act (aid TEXT PRIMARY KEY, agent TEXT NOT NULL, state TEXT NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS agent (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  }

  task(id: string): (TaskSnapshot & { keyId?: string }) | null {
    const row = this.sql.exec<Body>("SELECT body FROM task WHERE id = ?", id).toArray()[0];
    return row ? (JSON.parse(row.body) as TaskSnapshot) : null;
  }

  saveTask(t: TaskSnapshot & { keyId?: string }): void {
    this.sql.exec("INSERT OR REPLACE INTO task (id, state, updated, body) VALUES (?, ?, ?, ?)", t.id, t.state, t.updated, JSON.stringify(t));
  }

  tasks(state: string | null, limit: number): TaskSnapshot[] {
    const rows = state
      ? this.sql.exec<Body>("SELECT body FROM task WHERE state = ? ORDER BY updated DESC LIMIT ?", state, limit)
      : this.sql.exec<Body>("SELECT body FROM task ORDER BY updated DESC LIMIT ?", limit);
    return rows.toArray().map((r) => JSON.parse(r.body) as TaskSnapshot);
  }

  log(taskId: string, entry: TaskLogEntry): void {
    this.sql.exec("INSERT INTO task_log (task_id, body) VALUES (?, ?)", taskId, JSON.stringify(entry));
  }

  logs(taskId: string, limit: number): TaskLogEntry[] {
    const rows = this.sql.exec<Body>("SELECT body FROM task_log WHERE task_id = ? ORDER BY n DESC LIMIT ?", taskId, limit).toArray();
    return rows.map((r) => JSON.parse(r.body) as TaskLogEntry).reverse();
  }

  action(aid: string): { state: ActState; action: UserAction } | null {
    const row = this.sql.exec<{ state: string; body: string }>("SELECT state, body FROM act WHERE aid = ?", aid).toArray()[0];
    return row ? { state: row.state as ActState, action: JSON.parse(row.body) as UserAction } : null;
  }

  saveAction(agent: string, a: UserAction, state: ActState): void {
    this.sql.exec("INSERT OR REPLACE INTO act (aid, agent, state, ts, body) VALUES (?, ?, ?, ?, ?)", a.aid, agent, state, a.ts, JSON.stringify(a));
  }

  setActionState(aid: string, state: ActState): boolean {
    return this.sql.exec("UPDATE act SET state = ? WHERE aid = ? AND state != ?", state, aid, state).rowsWritten > 0;
  }

  unacked(agent: string, after: number): { state: ActState; action: UserAction }[] {
    const rows = this.sql.exec<{ state: string; body: string }>("SELECT state, body FROM act WHERE agent = ? AND state != 'acked' AND ts > ? ORDER BY ts", agent, after).toArray();
    return rows.map((r) => ({ state: r.state as ActState, action: JSON.parse(r.body) as UserAction }));
  }

  // 已确认与过期的动作只留幂等判断所需的时长
  pruneActions(before: number): void {
    this.sql.exec("DELETE FROM act WHERE ts < ?", before);
  }

  agent(id: string): AgentRow | null {
    const row = this.sql.exec<Body>("SELECT body FROM agent WHERE id = ?", id).toArray()[0];
    return row ? (JSON.parse(row.body) as AgentRow) : null;
  }

  saveAgent(row: AgentRow): void {
    this.sql.exec("INSERT OR REPLACE INTO agent (id, body) VALUES (?, ?)", row.info.id, JSON.stringify(row));
  }

  agents(): AgentRow[] {
    return this.sql.exec<Body>("SELECT body FROM agent ORDER BY id").toArray().map((r) => JSON.parse(r.body) as AgentRow);
  }
}
