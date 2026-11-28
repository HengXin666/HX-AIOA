import { useSyncExternalStore } from "react";
import { Emitter } from "../core/emitter";
import { STORAGE_AG_PREFS, STORAGE_AG_DRAFTS, DRAFT_MAX } from "./constants";

// 只存在这台设备上的工作台偏好 (同 t3code 的本地 UI 状态): 置顶, 归档, 已读, 折叠的项目, 左栏开关, 草稿与暂存
type Prefs = {
  pinned: string[];
  settled: string[];
  seen: Record<string, number>;
  folded: string[];
  sidebarOff: boolean;
  showSettled: boolean;
  stash: Record<string, string[]>;
  // 第一次用工作台的时间: 之前就完成的会话不算未读
  since: number;
};
const EMPTY: Prefs = { pinned: [], settled: [], seen: {}, folded: [], sidebarOff: false, showSettled: false, stash: {}, since: 0 };

const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? { ...d, ...(JSON.parse(v) as T) } : d;
  } catch {
    return d;
  }
};

let prefs: Prefs = load(STORAGE_AG_PREFS, EMPTY);
if (!prefs.since) {
  prefs = { ...prefs, since: Date.now() };
  try {
    localStorage.setItem(STORAGE_AG_PREFS, JSON.stringify(prefs));
  } catch {
    // 存不下就每次打开重算
  }
}
let drafts: Record<string, string> = load<Record<string, string>>(STORAGE_AG_DRAFTS, {});
const changed = new Emitter<void>();
let version = 0;

function save(next: Partial<Prefs>): void {
  prefs = { ...prefs, ...next };
  version++;
  try {
    localStorage.setItem(STORAGE_AG_PREFS, JSON.stringify(prefs));
  } catch {
    // 存满了就只留在内存
  }
  changed.emit();
}

// 别的标签页改了也跟上
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_AG_PREFS) {
    prefs = load(STORAGE_AG_PREFS, EMPTY);
    version++;
    changed.emit();
  }
});

export const key = (host: string, sid: string): string => `${host}/${sid}`;
const toggle = (list: string[], k: string): string[] => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

export const agPrefs = {
  get: (): Prefs => prefs,
  pinned: (k: string) => prefs.pinned.includes(k),
  settled: (k: string) => prefs.settled.includes(k),
  togglePin: (k: string) => save({ pinned: toggle(prefs.pinned, k) }),
  toggleSettle: (k: string) => save({ settled: toggle(prefs.settled, k), pinned: prefs.pinned.filter((x) => x !== k) }),
  unsettle: (k: string) => prefs.settled.includes(k) && save({ settled: prefs.settled.filter((x) => x !== k) }),
  forget: (k: string) => save({ pinned: prefs.pinned.filter((x) => x !== k), settled: prefs.settled.filter((x) => x !== k), seen: omit(prefs.seen, k), stash: omit(prefs.stash, k) }),
  // 看过这个会话到 updated 为止; 之后又有新完成的就算未读
  markSeen: (k: string, at: number) => (prefs.seen[k] ?? 0) < at && save({ seen: { ...prefs.seen, [k]: at } }),
  unread: (k: string, updated: number) => updated > (prefs.seen[k] ?? prefs.since),
  toggleFold: (g: string) => save({ folded: toggle(prefs.folded, g) }),
  toggleSidebar: () => save({ sidebarOff: !prefs.sidebarOff }),
  toggleShowSettled: () => save({ showSettled: !prefs.showSettled }),
  stash: (k: string): string[] => prefs.stash[k] ?? [],
  push: (k: string, text: string) => save({ stash: { ...prefs.stash, [k]: [text, ...(prefs.stash[k] ?? [])].slice(0, DRAFT_MAX) } }),
  pop: (k: string): string | undefined => {
    const [head, ...rest] = prefs.stash[k] ?? [];
    if (head !== undefined) save({ stash: { ...prefs.stash, [k]: rest } });
    return head;
  },
};

function omit<T>(o: Record<string, T>, k: string): Record<string, T> {
  const n = { ...o };
  delete n[k];
  return n;
}

let draftTimer: ReturnType<typeof setTimeout> | undefined;
export const agDrafts = {
  get: (k: string): string => drafts[k] ?? "",
  // 每次输入都更新内存, 落盘合并成 300 ms 一次
  set: (k: string, text: string) => {
    if (text) drafts[k] = text;
    else delete drafts[k];
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_AG_DRAFTS, JSON.stringify(drafts));
      } catch {
        // 存满了就只留在内存
      }
    }, 300);
  },
  has: (k: string): boolean => Boolean(drafts[k]),
};

export const useAgPrefs = (): Prefs => {
  useSyncExternalStore(
    (fn) => changed.on(fn),
    () => version,
  );
  return prefs;
};
