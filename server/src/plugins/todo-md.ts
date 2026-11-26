import type { TodoItem, TodoState } from "@hx-aioa/protocol";
import { DEFAULT_TZ_MIN } from "./todo-plan";

// 给外部 AI 看的待办: 按创建日期分天, 天里按仓库, 父子缩进
export const STATE_TEXT: Record<TodoState, string> = { open: "待进行", hold: "挂起", doing: "进行中", done: "已完成", dropped: "已放弃" };
const TZ_OFFSET = DEFAULT_TZ_MIN * 60_000;
const NO_REPO = "未关联仓库";
const finished = (t: TodoItem) => t.state === "done" || t.state === "dropped";

export const dayOf = (ts: number) => new Date(ts + TZ_OFFSET).toISOString().slice(0, 10);

function line(t: TodoItem, depth: number): string {
  const box = finished(t) ? "[x]" : "[ ]";
  const issue = t.repo && t.issue ? ` (${t.repo}#${t.issue}${t.gh ? ` ${t.gh.state === "closed" ? "已关闭" : `${t.gh.comments} 评论`}` : ""})` : "";
  const note = t.note ? ` - ${t.note.replace(/\s+/g, " ").slice(0, 160)}` : "";
  const plan = [t.star ? "★" : "", t.area ? `{${t.area}}` : "", t.due ? `截止 ${new Date(t.due + TZ_OFFSET).toISOString().slice(0, 16).replace("T", " ")}` : "", t.every ? `每 ${t.every.n} ${t.every.unit}` : ""].filter(Boolean).join(" ");
  return `${"  ".repeat(depth)}- ${box} \`${t.id}\` [${STATE_TEXT[t.state]}] P${t.prio} ${t.title}${plan ? ` (${plan})` : ""}${issue}${note}`;
}

/** 父子关系: parent 字段优先, 其次 GitHub 的父 issue。 */
export function parentOf(t: TodoItem, all: TodoItem[]): TodoItem | undefined {
  if (t.parent) return all.find((x) => x.id === t.parent);
  if (t.gh?.parent && t.repo) return all.find((x) => x.repo === t.repo && x.issue === t.gh!.parent);
  return undefined;
}

export function todosMarkdown(title: string, todos: TodoItem[], opt: { all?: boolean } = {}): string {
  const shown = todos.filter((t) => opt.all || !finished(t)).sort((a, b) => dayOf(b.created).localeCompare(dayOf(a.created)) || (a.repo ?? NO_REPO).localeCompare(b.repo ?? NO_REPO) || b.created - a.created);
  const out = [`# ${title}`, "", `${shown.length} 条${opt.all ? "" : "未完成"}待办, 状态: 待进行 / 挂起 / 进行中 / 已完成。`];
  const kids = new Map<string, TodoItem[]>();
  const roots: TodoItem[] = [];
  for (const t of shown) {
    const p = parentOf(t, shown);
    if (p) (kids.get(p.id) ?? kids.set(p.id, []).get(p.id)!).push(t);
    else roots.push(t);
  }
  const walk = (t: TodoItem, d: number, acc: string[]) => {
    acc.push(line(t, d));
    for (const k of kids.get(t.id) ?? []) walk(k, d + 1, acc);
  };
  let day = "";
  let repo = "";
  for (const t of roots) {
    const d = dayOf(t.created);
    if (d !== day) {
      out.push("", `## ${d}`);
      day = d;
      repo = "";
    }
    const r = t.repo ?? NO_REPO;
    if (r !== repo) {
      out.push(`### ${r}`);
      repo = r;
    }
    walk(t, 0, out);
  }
  return out.join("\n") + "\n";
}
