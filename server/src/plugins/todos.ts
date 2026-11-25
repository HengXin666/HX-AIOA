import { MAX_TODOS, PDATA_ID_RE, TODO_COLL, TODO_PLUGIN, todoOf, todoRowId, type TodoBody, type TodoInput, type TodoItem } from "@hx-aioa/protocol";
import { PDataStore } from "./pdata";
import { migrateTodo, type Tx } from "./todo-migrate";

const DEFAULT_PRIO = 2;
// 写入结果: 改了的条目与最后一次的 rev (0 表示没写库), 用来推 pdata_sync
export type TodoWrite = { todos: TodoItem[]; rev: number };

/**
 * 旧待办接口 (/chats/{群}/todos) 的转发层: 数据在 pdata (主人账号, hengxin666.todo, items),
 * 行 id 是 <群>:<待办 id>; 保留一个大版本, 之后删除。
 */
export class TodoStore {
  private readonly pdata: PDataStore;

  constructor(sql: SqlStorage, private readonly owner: () => string, tx: Tx) {
    this.pdata = new PDataStore(sql);
    migrateTodo(sql, this.pdata, owner, tx);
  }

  private rows(grp: string) {
    return this.pdata.withPrefix(this.owner(), TODO_PLUGIN, TODO_COLL, `${grp}:`);
  }

  list(grp: string): TodoItem[] {
    return this.rows(grp).flatMap((it) => todoOf(it, grp) ?? []);
  }

  /** 按 id 合并; 返回错误文字或改后的条目, 内容没变的不写库。 */
  upsert(grp: string, inputs: TodoInput[], now = Date.now()): TodoWrite | string {
    const acct = this.owner();
    const live = new Set(this.list(grp).map((t) => t.id));
    const fresh = inputs.filter((i) => !live.has(i.id));
    if (live.size + fresh.length > MAX_TODOS) return `每个群最多 ${MAX_TODOS} 条待办, 先删掉一些已完成的`;
    if (fresh.some((i) => !i.title)) return "新增待办需要 title";
    if (fresh.some((i) => !PDATA_ID_RE.test(todoRowId(grp, i.id)))) return "群名加待办 id 超过 64 字, 换个短一点的 id";
    const out: TodoWrite = { todos: [], rev: 0 };
    for (const i of inputs) {
      const rid = todoRowId(grp, i.id);
      const cur = this.pdata.get(acct, TODO_PLUGIN, TODO_COLL, rid);
      const old = cur && !cur.deleted ? (cur.body as TodoBody) : null;
      const next: TodoBody = { ...(old ?? { channel: grp, title: i.title!, state: "open", prio: DEFAULT_PRIO, created: now }) };
      if (i.title !== undefined) next.title = i.title;
      if (i.state !== undefined) next.state = i.state;
      if (i.prio !== undefined) next.prio = i.prio;
      if (i.note === null) delete next.note;
      else if (i.note !== undefined) next.note = i.note;
      if (i.src === null) delete next.src;
      else if (i.src !== undefined) next.src = i.src;
      if (old && JSON.stringify(old) === JSON.stringify(next)) continue;
      const r = this.pdata.put(acct, TODO_PLUGIN, TODO_COLL, rid, cur?.ver ?? 0, next, now);
      if ("error" in r) return r.error;
      if (!("ok" in r)) return "待办正被别处修改, 请重试";
      out.todos.push(todoOf(r.ok)!);
      out.rev = r.ok.rev;
    }
    return out;
  }

  /** 删除写墓碑, 新客户端按增量同步删掉本地副本; 返回 rev, 没有这条返回 0。 */
  remove(grp: string, id: string): number {
    const acct = this.owner();
    const rid = todoRowId(grp, id);
    const cur = this.pdata.get(acct, TODO_PLUGIN, TODO_COLL, rid);
    if (!cur || cur.deleted) return 0;
    const r = this.pdata.remove(acct, TODO_PLUGIN, TODO_COLL, rid, cur.ver);
    return "ok" in r ? r.ok.rev : 0;
  }
}
