import { MAX_TODOS, type TodoGh, type TodoInput, type TodoItem, type TodoState } from "@hx-aioa/protocol";

type Row = { body: string };
type GrpRow = { grp: string; body: string };
const DONE: TodoState = "done";
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
      for (const k of ["repo", "issue", "parent"] as const) {
        if (i[k] === null) delete next[k];
        else if (i[k] !== undefined) (next as Record<string, unknown>)[k] = i[k];
      }
      // 换了关联就丢掉旧的同步状态
      if (cur && (cur.repo !== next.repo || cur.issue !== next.issue)) delete next.gh;
      stamp(next, cur?.state, now);
      if (cur && JSON.stringify({ ...cur, updated: 0 }) === JSON.stringify({ ...next, updated: 0 })) continue;
      next.updated = now;
      this.sql.exec("INSERT OR REPLACE INTO todo (grp, id, body) VALUES (?, ?, ?)", grp, i.id, JSON.stringify(next));
      out.push(next);
    }
    return out;
  }

  /** 关联了 issue 的待办 (全部群); 总量有 500 条/群的上限, 直接扫。 */
  linked(): { grp: string; item: TodoItem }[] {
    return this.sql
      .exec<GrpRow>("SELECT grp, body FROM todo WHERE body LIKE '%\"issue\":%'")
      .toArray()
      .map((r) => ({ grp: r.grp, item: JSON.parse(r.body) as TodoItem }))
      .filter((x) => x.item.repo && x.item.issue);
  }

  /** 写入 GitHub 同步结果, 可顺带改状态; 返回改后的条目。 */
  setGh(grp: string, id: string, gh: TodoGh, state?: TodoState, now = Date.now()): TodoItem | null {
    const cur = this.get(grp, id);
    if (!cur) return null;
    const next: TodoItem = { ...cur, gh, ...(state ? { state } : {}) };
    if (state && state !== cur.state) {
      stamp(next, cur.state, now);
      next.updated = now;
    }
    this.sql.exec("UPDATE todo SET body = ? WHERE grp = ? AND id = ?", JSON.stringify(next), grp, id);
    return next;
  }

  remove(grp: string, id: string): boolean {
    return this.sql.exec("DELETE FROM todo WHERE grp = ? AND id = ?", grp, id).rowsWritten > 0;
  }
}

// 进入 done 记完成时间, 离开就去掉
function stamp(t: TodoItem, prev: TodoState | undefined, now: number): void {
  if (t.state === DONE && prev !== DONE) t.doneAt = now;
  else if (t.state !== DONE) delete t.doneAt;
}
