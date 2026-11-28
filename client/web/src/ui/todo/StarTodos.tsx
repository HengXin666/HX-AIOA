import { Card } from "@hx/ui/ui/card";
import { Button } from "@hx/ui/ui/button";
import { ListTodo } from "lucide-react";
import { useState } from "react";
import { link } from "../../app/router";
import { todos, type TodoDraft } from "../../core/todos";
import { areasOf, finished } from "./model";
import { TodoCard, useTodos } from "./TodoBoard";
import { TodoEdit } from "./TodoEdit";

const MAX_SHOWN = 6;

// 总览上的 "重点待办" (对照安卓总览的待办空间): 标了重点且没完成的, 没有就显示最近要截止的
export function StarTodos() {
  const all = useTodos();
  const [edit, setEdit] = useState<TodoDraft | null>(null);
  const open = all.filter((t) => !finished(t));
  const star = open.filter((t) => t.star);
  const rows = (star.length ? star : open.filter((t) => t.due !== undefined).sort((a, b) => a.due! - b.due!)).slice(0, MAX_SHOWN);
  if (!todos.loaded || !all.length) return null;
  return (
    <Card className="flex flex-col gap-2 p-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-foreground [&_svg]:size-4">
        <ListTodo className="text-muted-foreground" />
        <span className="flex-1">{star.length ? "重点待办" : "快到期的待办"}</span>
        <span className="text-xs text-muted-foreground">{open.length} 条未完成</span>
        <Button asChild size="xs" variant="ghost">
          <a href={link("overview", "todo")}>全部</a>
        </Button>
      </h3>
      {rows.length ? (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
          {rows.map((t) => (
            <TodoCard key={`${t.channel}:${t.id}`} t={t} all={all} showGroup onOpen={() => setEdit(todos.draftOf(t))} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">没有重点或带截止的待办。</p>
      )}
      {edit && <TodoEdit draft={edit} fresh={false} areas={areasOf(all)} onClose={() => setEdit(null)} />}
    </Card>
  );
}
