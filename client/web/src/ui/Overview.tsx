import type { OverviewItem, Priority, TaskSnapshot } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Progress } from "@hx/ui/ui/progress";
import { useFeed, useLinkState } from "../app/hooks";
import { go, link } from "../app/router";
import { groupOf, textOf, type Message } from "../core/chats";
import { TXT_LOADING } from "../core/constants";
import { shortTime } from "./ChatList";
import { StarTodos } from "./todo/StarTodos";

const LAYERS: { key: Priority; title: string; dot: "destructive" | "info" | "muted" }[] = [
  { key: "need_me", title: "需要我", dot: "destructive" },
  { key: "happening", title: "正在发生", dot: "info" },
  { key: "worth_reading", title: "值得一看", dot: "muted" },
];

// 总览: overview 快照打底, ev / task 帧实时合并 (core/feed.ts), 不轮询
export default function Overview() {
  const snap = useFeed();
  const state = useLinkState();
  const data = snap.loaded ? { generatedAt: snap.generatedAt, layers: snap.layers, tasks: Object.values(snap.tasks).sort((a, b) => b.updated - a.updated) } : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-3 pb-6">
        <header className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-foreground">总览</h2>
          {data && <span className="text-xs text-muted-foreground">{shortTime(data.generatedAt)} 生成</span>}
        </header>
        {!data && <p className="text-sm text-muted-foreground">{state === "online" ? TXT_LOADING : "连上后加载"}</p>}
        <StarTodos />
        {data && data.tasks.length > 0 && <Tasks tasks={data.tasks} />}
        {data && (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {LAYERS.map((l) => (
              <section key={l.key} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
                <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Badge variant="outline" dot={l.dot}>
                    {l.title}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{data.layers[l.key]?.length ?? 0}</span>
                </h3>
                <ul className="flex flex-col gap-1">
                  {(data.layers[l.key] ?? []).map((it) => (
                    <Item key={it.ev.id} it={it} />
                  ))}
                  {!data.layers[l.key]?.length && <li className="text-xs text-muted-foreground">暂无</li>}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Item({ it }: { it: OverviewItem }) {
  const ev = it.ev as Message;
  const g = it.ev.kind === "metric" ? null : groupOf(it.ev);
  const line = it.ev.kind === "metric" ? it.ev.source.name : textOf(ev).split("\n")[0];
  return (
    <li>
      <button
        type="button"
        disabled={!g}
        onClick={() => g && go({ name: "chat", channel: g })}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:hover:bg-transparent"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{line}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {it.ev.source.name} · {shortTime(it.ev.ts)}
          </span>
        </span>
        {it.count > 1 && <Badge variant="secondary">×{it.count}</Badge>}
      </button>
    </li>
  );
}

const TASK_TEXT: Record<string, string> = { running: "进行中", waiting: "等我", done: "完成", failed: "失败", cancelled: "已取消" };

function Tasks({ tasks }: { tasks: TaskSnapshot[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <h3 className="flex items-center text-sm font-medium text-foreground">
        <span className="flex-1">任务</span>
        <a href={link("agent")} className="text-xs text-muted-foreground hover:text-foreground">
          去 Agent 栏
        </a>
      </h3>
      <ul className="flex flex-col gap-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-foreground">{t.title}</span>
              <Badge variant="outline" dot={t.state === "waiting" ? "warning" : t.state === "failed" ? "destructive" : t.state === "done" ? "success" : "info"}>
                {TASK_TEXT[t.state] ?? t.state}
              </Badge>
            </div>
            {t.state === "running" && typeof t.progress === "number" && <Progress value={t.progress * 100} />}
            {t.step && <span className="text-xs text-muted-foreground">{t.step}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
