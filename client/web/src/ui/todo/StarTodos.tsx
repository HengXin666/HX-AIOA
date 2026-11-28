import { Button } from "@hx/ui/ui/button";
import { ChevronRight, ListTodo } from "lucide-react";
import { useState } from "react";
import { link } from "../../app/router";
import { todos, type TodoDraft } from "../../core/todos";
import { Panel, Quiet } from "../overview/parts";
import { areasOf, finished } from "./model";
import { TodoCard, useTodos } from "./TodoBoard";
import { TodoEdit } from "./TodoEdit";

const MAX_SHOWN = 6;

// 总览上的 "重点待办" (对照安卓 TodoFocus): 标了重点的在前, 再按截止与进行中补满
export function StarTodos({ className }: { className?: string }) {
  const all = useTodos();
  const [edit, setEdit] = useState<TodoDraft | null>(null);
  const open = all.filter((t) => !finished(t));
  const star = open.filter((t) => t.star);
  // 重点在前, 再补快到期的与进行中的, 凑满一屏
  const rest = open.filter((t) => !t.star).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || Number(b.state === "doing") - Number(a.state === "doing") || a.prio - b.prio);
  const rows = [...star, ...rest].slice(0, MAX_SHOWN);
  return (
    <Panel
      title="重点待办"
      icon={<ListTodo />}
      count={open.length}
      hint="未完成"
      className={className}
      action={
        <Button asChild size="xs" variant="ghost">
          <a href={link("overview", "todo")}>
            看板
            <ChevronRight />
          </a>
        </Button>
      }
    >
      {rows.length ? (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {rows.map((t) => (
            <TodoCard key={`${t.channel}:${t.id}`} t={t} all={all} showGroup onOpen={() => setEdit(todos.draftOf(t))} />
          ))}
        </div>
      ) : (
        <Quiet icon={<ListTodo />}>{todos.error ? "待办插件没有启用" : !todos.loaded ? "加载中" : "没有未完成的待办"}</Quiet>
      )}
      {edit && <TodoEdit draft={edit} fresh={false} areas={areasOf(all)} onClose={() => setEdit(null)} />}
    </Panel>
  );
}
