import { PATH_PDATA_COLL, PATH_PDATA_ITEM, QUERY_SINCE, TODO_COLL, TODO_PLUGIN, todoOf, type PDataItem, type PDataList, type TodoBody, type TodoItem, type TodoState } from "@hx-aioa/protocol";
import { toast } from "sonner";
import { api, ApiError, authChanged, fill } from "./auth";
import { Emitter } from "./emitter";
import { link } from "./link";

// 一条待办带上它所在的群
export type Todo = TodoItem & { channel: string };
export type TodoDraft = Omit<TodoBody, "created"> & { id: string };
const HTTP_CONFLICT = 409;
const COLL = fill(PATH_PDATA_COLL, TODO_PLUGIN, TODO_COLL);
const itemPath = (rowId: string) => fill(PATH_PDATA_ITEM, TODO_PLUGIN, TODO_COLL, rowId);
export const DEFAULT_TODO_GROUP = "plugin-todo";
// App 里新建的待办 id: m- 加时间 (36 进制), 与 Agent 的 t-<seq> 区分
export const newTodoId = () => `m-${Date.now().toString(36)}`;

// 待办 (对照安卓 SpacesState 的待办部分): 数据在插件数据 pdata 的一个集合里, 各群共用;
// 第一次用到时全量拉, 之后收到 pdata_sync 按 rev 增量拉; 写回带行版本, 冲突就重拉
class TodoStore {
  readonly changed = new Emitter<void>();
  version = 0;
  loaded = false;
  error: string | null = null;
  private rows = new Map<string, PDataItem>();
  private rev = 0;
  private asked = false;
  private pulling: Promise<void> | null = null;
  private list: Todo[] = [];

  attach(): () => void {
    const offFrames = link.frames.on((f) => {
      if (f.t === "pdata_sync" && f.plugin === TODO_PLUGIN && f.coll === TODO_COLL && Number(f.rev) > this.rev && this.asked) void this.pull();
    });
    const offAuth = authChanged.on((u) => !u && this.reset());
    return () => {
      offFrames();
      offAuth();
    };
  }

  all(): Todo[] {
    if (!this.asked) {
      this.asked = true;
      void this.pull();
    }
    return this.list;
  }

  async pull(): Promise<void> {
    this.pulling ??= (async () => {
      try {
        let more = true;
        while (more) {
          const r = await api<PDataList>(`${COLL}?${QUERY_SINCE}=${this.rev}`);
          if (r.reset) this.rows.clear();
          for (const it of r.items) {
            if (it.deleted) this.rows.delete(it.id);
            else this.rows.set(it.id, it);
          }
          this.rev = r.rev;
          more = r.more;
        }
        this.error = null;
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      } finally {
        this.loaded = true;
        this.pulling = null;
        this.rebuild();
      }
    })();
    return this.pulling;
  }

  // 新建或整行改: 新建 ver 0, 改时带读到的版本; 先改本地, 失败再重拉
  async save(d: TodoDraft, fresh: boolean): Promise<void> {
    const rowId = `${d.channel}:${d.id}`;
    const cur = this.rows.get(rowId);
    const old = (cur?.body ?? {}) as Partial<TodoBody>;
    const body: TodoBody = { ...old, ...d, created: old.created ?? Date.now() } as TodoBody;
    delete (body as Partial<TodoDraft>).id;
    for (const k of Object.keys(body) as (keyof TodoBody)[]) if (body[k] === undefined || body[k] === null) delete body[k];
    if (d.state === "done" && old.state !== "done") body.doneAt = Date.now();
    this.rows.set(rowId, { id: rowId, ver: cur?.ver ?? 0, rev: cur?.rev ?? 0, updated: Date.now(), body });
    this.rebuild();
    await this.write(() => api(itemPath(rowId), { method: "PUT", body: JSON.stringify({ ver: fresh ? 0 : (cur?.ver ?? 0), body }) }));
  }

  setState(t: Todo, state: TodoState): Promise<void> {
    return this.save({ ...this.draftOf(t), state }, false);
  }

  async remove(t: Todo): Promise<void> {
    const rowId = `${t.channel}:${t.id}`;
    const cur = this.rows.get(rowId);
    this.rows.delete(rowId);
    this.rebuild();
    if (cur) await this.write(() => api(`${itemPath(rowId)}?ver=${cur.ver}`, { method: "DELETE" }));
  }

  draftOf(t: Todo): TodoDraft {
    const { updated: _u, created: _c, gh: _g, runs: _r, lastDone: _l, prevDue: _p, doneAt: _d, ...rest } = t;
    return rest;
  }

  private async write(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      // 版本冲突不提示, 重拉即可; 其它错误告诉用户
      if (!(e instanceof ApiError && e.status === HTTP_CONFLICT)) toast.error(`待办没保存: ${e instanceof Error ? e.message : String(e)}`);
    }
    await this.pull();
  }

  private rebuild(): void {
    this.list = [...this.rows.values()].flatMap((it) => {
      const t = todoOf(it);
      const ch = (it.body as TodoBody | undefined)?.channel;
      return t && ch ? [{ ...t, channel: ch }] : [];
    });
    this.version++;
    this.changed.emit();
  }

  private reset(): void {
    this.rows.clear();
    this.rev = 0;
    this.asked = false;
    this.loaded = false;
    this.rebuild();
  }
}

export const todos = new TodoStore();
