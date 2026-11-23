import { MAX_TODOS, type TodoInput, type TodoItem } from "@hx-aioa/protocol";

type Row = { body: string };
const DEFAULT_PRIO = 2;

/** 群下的待办: 一行一条, 改一条只写一行; 整群读一次就是全部 (上限 500)。 */
export class TodoStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS todo (grp TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (grp, id))");
  }

  list(grp: string): TodoItem[] {
    return this.sql.exec<Row>("SELECT body FROM todo WHERE grp = ?", grp).toArray().map((r) => JSON.parse(r.body) as TodoItem);
  }

  get(grp: string, id: string): TodoItem | null {
    const r = this.sql.exec<Row>("SELECT body FROM todo WHERE grp = ? AND id = ?", grp, id).toArray()[0];
    return r ? (JSON.parse(r.body) as TodoItem) : null;
  }

  /** 按 id 合并; 返回错误文字或改后的条目, 内容没变的不写库。 */
  upsert(grp: string, inputs: TodoInput[], now = Date.now()): TodoItem[] | string {
    const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM todo WHERE grp = ?", grp).one().n;
    const fresh = inputs.filter((i) => !this.get(grp, i.id));
    if (count + fresh.length > MAX_TODOS) return `每个群最多 ${MAX_TODOS} 条待办, 先删掉一些已完成的`;
    if (fresh.some((i) => !i.title)) return "新增待办需要 title";
    const out: TodoItem[] = [];
    for (const i of inputs) {
      const cur = this.get(grp, i.id);
      const next: TodoItem = { ...(cur ?? { id: i.id, title: i.title!, state: "open", prio: DEFAULT_PRIO, created: now, updated: now }) };
      if (i.title !== undefined) next.title = i.title;
      if (i.state !== undefined) next.state = i.state;
      if (i.prio !== undefined) next.prio = i.prio;
      if (i.note === null) delete next.note;
      else if (i.note !== undefined) next.note = i.note;
      if (i.src === null) delete next.src;
      else if (i.src !== undefined) next.src = i.src;
      if (cur && JSON.stringify({ ...cur, updated: 0 }) === JSON.stringify({ ...next, updated: 0 })) continue;
      next.updated = now;
      this.sql.exec("INSERT OR REPLACE INTO todo (grp, id, body) VALUES (?, ?, ?)", grp, i.id, JSON.stringify(next));
      out.push(next);
    }
    return out;
  }

  remove(grp: string, id: string): boolean {
    return this.sql.exec("DELETE FROM todo WHERE grp = ? AND id = ?", grp, id).rowsWritten > 0;
  }
}
