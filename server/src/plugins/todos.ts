import { MAX_TODOS, PDATA_ID_RE, TODO_PLAN_KEYS, checkTodoBody, TODO_COLL, TODO_PLUGIN, todoOf, todoRowId, type PDataItem, type TodoBody, type TodoGh, type TodoInput, type TodoItem, type TodoState } from "@hx-aioa/protocol";
import { PDataStore } from "./pdata";
import { migrateTodo, type Tx } from "./todo-migrate";
import { rollTodo } from "./todo-plan";

const DEFAULT_PRIO = 2;
const DONE: TodoState = "done";
// 写入结果: 改了的条目与最后一次的 rev (0 表示没写库), 用来推 pdata_sync
export type TodoWrite = { todos: TodoItem[]; rev: number };
export type TodoLinked = { grp: string; item: TodoItem };

/**
 * 服务端维护的字段, 不管谁写 (旧接口, pdata, 同步) 都按上一版补齐:
 * 进入 done 记 doneAt, 离开就去掉; gh 是 GitHub 同步状态, 只在关联不变时沿用, 客户端写的不算。
 */
export function normTodo(prev: TodoBody | null, next: TodoBody, now = Date.now()): TodoBody {
  // 只赋值或删除, 不改字段顺序, 免得内容没变也写一次库
  const out: TodoBody = { ...next };
  if (out.state !== DONE) delete out.doneAt;
  else out.doneAt = prev?.state === DONE ? (prev.doneAt ?? out.doneAt ?? now) : now;
  if (prev?.gh && prev.repo === out.repo && prev.issue === out.issue) out.gh = prev.gh;
  else delete out.gh;
  // 周期待办刚完成: 推到下一期 (回到 open, 不留 doneAt), 免得每期都手动新建
  if (out.state === DONE && prev?.state !== DONE && out.every && out.due) return rollTodo(out, now);
  return out;
}

const live = (it: PDataItem | null): TodoBody | null => (it && !it.deleted ? (it.body as TodoBody) : null);

/**
 * 旧待办接口 (/chats/{群}/todos) 的转发层: 数据在 pdata (调用者自己的账号, hengxin666.todo, items),
 * 行 id 是 <群>:<待办 id>; 待办归个人, 子号写的是自己的, 默认主人。保留一个大版本, 之后删除。
 */
export class TodoStore {
  private readonly pdata: PDataStore;

  constructor(sql: SqlStorage, pdata: PDataStore, private readonly owner: () => string, tx: Tx) {
    this.pdata = pdata;
    migrateTodo(sql, this.pdata, owner, tx);
  }

  private rows(prefix: string, acct = this.owner()) {
    return this.pdata.withPrefix(acct, TODO_PLUGIN, TODO_COLL, prefix);
  }

  list(grp: string, acct = this.owner()): TodoItem[] {
    return this.rows(`${grp}:`, acct).flatMap((it) => todoOf(it, grp) ?? []);
  }

  get(grp: string, id: string, acct = this.owner()): TodoItem | null {
    const it = this.pdata.get(acct, TODO_PLUGIN, TODO_COLL, todoRowId(grp, id));
    return it ? todoOf(it, grp) : null;
  }

  /** 按 id 合并; 返回错误文字或改后的条目, 内容没变的不写库。 */
  upsert(grp: string, inputs: TodoInput[], now = Date.now(), acct = this.owner()): TodoWrite | string {
    const have = new Set(this.list(grp, acct).map((t) => t.id));
    const fresh = inputs.filter((i) => !have.has(i.id));
    if (have.size + fresh.length > MAX_TODOS) return `每个群最多 ${MAX_TODOS} 条待办, 先删掉一些已完成的`;
    if (fresh.some((i) => !i.title)) return "新增待办需要 title";
    if (fresh.some((i) => !PDATA_ID_RE.test(todoRowId(grp, i.id)))) return "群名加待办 id 超过 64 字, 换个短一点的 id";
    const out: TodoWrite = { todos: [], rev: 0 };
    for (const i of inputs) {
      const rid = todoRowId(grp, i.id);
      const cur = this.pdata.get(acct, TODO_PLUGIN, TODO_COLL, rid);
      const old = live(cur);
      const next: TodoBody = { ...(old ?? { channel: grp, title: i.title!, state: "open", prio: DEFAULT_PRIO, created: now }) };
      if (i.title !== undefined) next.title = i.title;
      if (i.state !== undefined) next.state = i.state;
      if (i.prio !== undefined) next.prio = i.prio;
      for (const k of ["note", "src", "repo", "issue", "parent", ...TODO_PLAN_KEYS] as const) {
        if (i[k] === null) delete next[k];
        else if (i[k] !== undefined) (next as Record<string, unknown>)[k] = i[k];
      }
      const body = normTodo(old, next, now);
      if (old && JSON.stringify(old) === JSON.stringify(body)) continue;
      const bad = checkTodoBody(rid, body);
      if (bad) return bad;
      const r = this.pdata.put(acct, TODO_PLUGIN, TODO_COLL, rid, cur?.ver ?? 0, body, now);
      if ("error" in r) return r.error;
      if (!("ok" in r)) return "待办正被别处修改, 请重试";
      out.todos.push(todoOf(r.ok)!);
      out.rev = r.ok.rev;
    }
    return out;
  }

  /** 关联了 issue 的待办 (主人账号的全部群, GitHub 授权只归主人); 总量有 2000 行的上限, 直接扫。 */
  linked(): TodoLinked[] {
    return this.rows("").flatMap((it) => {
      const b = it.body as TodoBody;
      const item = todoOf(it);
      return item && b.repo && b.issue ? [{ grp: b.channel, item }] : [];
    });
  }

  /** 写入 GitHub 同步结果, 可顺带改状态; 返回改后的条目与 rev, 没变返回 rev 0。 */
  setGh(grp: string, id: string, gh: TodoGh, state?: TodoState, now = Date.now()): { item: TodoItem; rev: number } | null {
    const acct = this.owner();
    const rid = todoRowId(grp, id);
    const cur = this.pdata.get(acct, TODO_PLUGIN, TODO_COLL, rid);
    const old = live(cur);
    if (!cur || !old) return null;
    const body = { ...normTodo(old, { ...old, ...(state ? { state } : {}) }, now), gh };
    if (JSON.stringify(old) === JSON.stringify(body)) return { item: todoOf(cur)!, rev: 0 };
    // 同步状态不算主人或 Agent 的改动: 只改 gh 时保留原 updated
    const r = this.pdata.put(acct, TODO_PLUGIN, TODO_COLL, rid, cur.ver, body, state && state !== old.state ? now : cur.updated);
    return "ok" in r ? { item: todoOf(r.ok)!, rev: r.ok.rev } : null;
  }

  /** 删除写墓碑, 新客户端按增量同步删掉本地副本; 返回 rev, 没有这条返回 0。 */
  remove(grp: string, id: string, acct = this.owner()): number {
    const rid = todoRowId(grp, id);
    const cur = this.pdata.get(acct, TODO_PLUGIN, TODO_COLL, rid);
    if (!cur || cur.deleted) return 0;
    const r = this.pdata.remove(acct, TODO_PLUGIN, TODO_COLL, rid, cur.ver);
    return "ok" in r ? r.ok.rev : 0;
  }
}
