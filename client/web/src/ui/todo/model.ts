import type { TodoState } from "@hx-aioa/protocol";
import { DEFAULT_TODO_GROUP, type Todo } from "../../core/todos";

// 待办的分组与文案 (对照安卓 todo/TodoModel.kt)
export const AXES = [
  { id: "state", label: "看板" },
  { id: "area", label: "分区" },
  { id: "due", label: "截止" },
  { id: "repo", label: "仓库" },
] as const;
export type Axis = (typeof AXES)[number]["id"];
export const STATES: TodoState[] = ["open", "doing", "hold", "done"];
export const STATE_LABEL: Record<TodoState, string> = { open: "待进行", doing: "进行中", hold: "挂起", done: "已完成", dropped: "已完成" };
export const PRIO_LABEL = { 1: "急", 2: "普通", 3: "以后" } as const;
export const PRESET_AREAS = ["生活", "开发", "工作", "学习"];
export const AREA_NONE = "未分区";
export const NO_REPO = "未关联仓库";
const DAY = 86_400_000;
const DUE_BUCKETS = ["已逾期", "今天", "明天", "7 天内", "以后", "无截止"];

export const finished = (t: Todo) => t.state === "done" || t.state === "dropped";
// 不填分区时: 关联了仓库算开发, 其余未分区
export const areaOf = (t: Todo) => t.area || (t.repo ? "开发" : AREA_NONE);
export const areasOf = (rows: Todo[]) => [...new Set([...PRESET_AREAS, ...rows.flatMap((t) => (t.area ? [t.area] : []))])];

export function homeGroup(rows: Todo[]): string {
  if (rows.some((t) => t.channel === DEFAULT_TODO_GROUP)) return DEFAULT_TODO_GROUP;
  const count = new Map<string, number>();
  for (const t of rows) count.set(t.channel, (count.get(t.channel) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_TODO_GROUP;
}

function dueBucket(due: number | undefined, now: number): number {
  if (due === undefined) return DUE_BUCKETS.length - 1;
  if (due < now) return 0;
  const today = new Date(now).setHours(0, 0, 0, 0);
  const d = Math.floor((due - today) / DAY);
  return d <= 0 ? 1 : d === 1 ? 2 : d < 7 ? 3 : 4;
}

export type Section = { key: string; title: string; items: Todo[] };

// 同组里: 重点在前, 急的在前, 有截止的按截止, 再按新建
const order = (a: Todo, b: Todo) => Number(Boolean(b.star)) - Number(Boolean(a.star)) || a.prio - b.prio || (a.due ?? Infinity) - (b.due ?? Infinity) || b.created - a.created;

export function sections(rows: Todo[], axis: Axis, now = Date.now()): Section[] {
  const by = new Map<string, Todo[]>();
  const keyOf = (t: Todo): string => {
    if (axis === "state") return t.state === "dropped" ? "done" : t.state;
    if (axis === "area") return areaOf(t);
    if (axis === "repo") return t.repo ?? NO_REPO;
    return String(dueBucket(t.due, now));
  };
  for (const t of rows) {
    const k = keyOf(t);
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  let keys = [...by.keys()];
  if (axis === "state") keys = STATES.filter((s) => by.has(s));
  if (axis === "due") keys.sort((a, b) => Number(a) - Number(b));
  if (axis === "area") keys.sort((a, b) => Number(a === AREA_NONE) - Number(b === AREA_NONE) || idx(a) - idx(b) || a.localeCompare(b));
  if (axis === "repo") keys.sort((a, b) => Number(a === NO_REPO) - Number(b === NO_REPO) || a.toLowerCase().localeCompare(b.toLowerCase()));
  return keys.map((k) => ({ key: k, title: axis === "state" ? STATE_LABEL[k as TodoState] : axis === "due" ? DUE_BUCKETS[Number(k)]! : k, items: by.get(k)!.sort(order) }));
}

const idx = (a: string) => {
  const i = PRESET_AREAS.indexOf(a);
  return i < 0 ? PRESET_AREAS.length : i;
};

// 父项显示全部子孙的完成进度
export function progressOf(t: Todo, all: Todo[]): [number, number] | null {
  const kids = all.filter((x) => x.channel === t.channel && x.parent === t.id);
  if (!kids.length) return null;
  let done = 0;
  let total = 0;
  for (const k of kids) {
    total++;
    if (finished(k)) done++;
    const sub = progressOf(k, all);
    if (sub) {
      done += sub[0];
      total += sub[1];
    }
  }
  return [done, total];
}

export function dueText(due: number, now = Date.now()): string {
  const d = new Date(due);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const day = `${sameYear ? "" : `${d.getFullYear()}-`}${d.getMonth() + 1}-${d.getDate()}`;
  const hm = d.getHours() || d.getMinutes() ? ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
  return day + hm;
}
