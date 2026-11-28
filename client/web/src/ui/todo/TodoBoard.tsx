import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Checkbox } from "@hx/ui/ui/checkbox";
import { CalendarClock, Eye, EyeOff, GitBranch, Plus, RefreshCw, Star } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { chats, titleOf } from "../../core/chats";
import { TXT_LOADING } from "../../core/constants";
import { newTodoId, todos, type Todo, type TodoDraft } from "../../core/todos";
import { areaOf, areasOf, AXES, dueText, finished, homeGroup, PRIO_LABEL, progressOf, sections, type Axis } from "./model";
import { TodoEdit } from "./TodoEdit";

const PREFS = "aioa.todo.board";
type Prefs = { axis: Axis; star: boolean; done: boolean };
const loadPrefs = (): Prefs => ({ axis: "state", star: false, done: false, ...(JSON.parse(localStorage.getItem(PREFS) ?? "{}") as Partial<Prefs>) });
const PRIO_DOT = { 1: "destructive", 2: "info", 3: "muted" } as const;

export const useTodos = () => {
  useSyncExternalStore((fn) => todos.changed.on(fn), () => todos.version);
  return todos.all();
};

// 待办看板 (对照安卓 todo/TodoBoard.kt, #152): 看板 / 分区 / 截止 / 仓库, 只看重点, 默认藏已完成; channel 不传时看全部群
export function TodoBoard({ channel }: { channel?: string }) {
  const all = useTodos();
  const [p, setP] = useState(loadPrefs);
  const [edit, setEdit] = useState<{ d: TodoDraft; fresh: boolean } | null>(null);
  useEffect(() => localStorage.setItem(PREFS, JSON.stringify(p)), [p]);
  const rows = all.filter((t) => (!channel || t.channel === channel) && (p.done || !finished(t)) && (!p.star || t.star));
  const secs = sections(rows, p.axis);
  const kanban = p.axis === "state";
  const areas = areasOf(all);
  const add = () =>
    setEdit({ fresh: true, d: { id: newTodoId(), channel: channel ?? homeGroup(all), title: "", state: "open", prio: 2 } });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 px-3 py-2">
        {AXES.map((a) => (
          <Button key={a.id} size="xs" variant={p.axis === a.id ? "secondary" : "ghost"} onClick={() => setP({ ...p, axis: a.id })}>
            {a.label}
          </Button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <Button size="xs" variant={p.star ? "secondary" : "ghost"} onClick={() => setP({ ...p, star: !p.star })}>
          <Star />
          重点
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setP({ ...p, done: !p.done })}>
          {p.done ? <EyeOff /> : <Eye />}
          {p.done ? "藏已完成" : "看已完成"}
        </Button>
        <span className="ml-auto flex gap-1">
          <Button size="icon-xs" variant="ghost" aria-label="刷新" onClick={() => void todos.pull()}>
            <RefreshCw />
          </Button>
          <Button size="xs" onClick={add}>
            <Plus />
            新建
          </Button>
        </span>
      </div>
      {todos.error && <p className="px-3 text-sm text-destructive">{todos.error}</p>}
      {!todos.loaded && <p className="px-3 text-sm text-muted-foreground">{TXT_LOADING}</p>}
      {todos.loaded && !secs.length && <p className="p-10 text-center text-sm text-muted-foreground">{all.length ? "筛选后没有待办" : "还没有待办, 点新建, 或在群里丢个想法"}</p>}
      <div className={`min-h-0 flex-1 overflow-auto px-3 pb-6 ${kanban ? "flex gap-3" : "flex flex-col gap-3"}`}>
        {secs.map((s) => (
          <section key={s.key} className={`flex flex-col gap-2 rounded-xl bg-muted/40 p-2 ${kanban ? "w-72 shrink-0 self-start" : ""}`}>
            <h3 className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
              {s.title}
              <span className="text-xs font-normal text-muted-foreground">{s.items.length}</span>
            </h3>
            <div className={kanban ? "flex flex-col gap-2" : "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]"}>
              {s.items.map((t) => (
                <Card key={`${t.channel}:${t.id}`} t={t} all={all} showGroup={!channel} onOpen={() => setEdit({ fresh: false, d: todos.draftOf(t) })} />
              ))}
            </div>
          </section>
        ))}
      </div>
      {edit && <TodoEdit draft={edit.d} fresh={edit.fresh} areas={areas} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function Card({ t, all, showGroup, onOpen }: { t: Todo; all: Todo[]; showGroup: boolean; onOpen: () => void }) {
  const done = finished(t);
  const prog = progressOf(t, all);
  const parent = t.parent ? all.find((x) => x.channel === t.channel && x.id === t.parent) : undefined;
  const overdue = !done && t.due !== undefined && t.due < Date.now();
  const group = chats.meta(t.channel);
  return (
    <div className="group flex items-start gap-2 rounded-lg border border-border bg-card p-2.5 shadow-xs transition-colors hover:border-ring/50">
      <Checkbox className="mt-0.5" checked={done} aria-label={done ? "标为未完成" : "完成"} onCheckedChange={(v) => void todos.setState(t, v ? "done" : "open")} />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        {parent && <span className="truncate text-xs text-muted-foreground">↳ {parent.title}</span>}
        <span className={`text-sm break-words ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
          {t.star && <Star className="mr-1 inline size-3.5 fill-current text-warning" />}
          {t.title}
        </span>
        {t.note && <span className="line-clamp-2 text-xs text-muted-foreground">{t.note}</span>}
        <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground [&_svg]:size-3">
          {t.prio !== 2 && (
            <Badge variant="outline" dot={PRIO_DOT[t.prio]}>
              {PRIO_LABEL[t.prio]}
            </Badge>
          )}
          {t.due !== undefined && (
            <span className={`flex items-center gap-0.5 ${overdue ? "text-destructive" : ""}`}>
              <CalendarClock />
              {dueText(t.due)}
            </span>
          )}
          {t.repo && (
            <span className="flex items-center gap-0.5">
              <GitBranch />
              {t.repo.split("/")[1]}
              {t.issue ? `#${t.issue}` : ""}
              {t.gh?.state === "closed" ? " 已关" : ""}
            </span>
          )}
          {prog && (
            <span>
              {prog[0]}/{prog[1]}
            </span>
          )}
          <span>{areaOf(t)}</span>
          {showGroup && group && <span className="truncate">· {titleOf(group)}</span>}
        </span>
      </button>
    </div>
  );
}
