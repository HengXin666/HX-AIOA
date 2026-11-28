import type { AgentStatus, Envelope, Overview, OverviewItem, Priority, TaskSnapshot, UserActionKind } from "@hx-aioa/protocol";
import { ACT_QUEUED, AID_LENGTH, LAYER_MAX, TXT_ACT_FAILED, TXT_ACT_OFFLINE, TXT_ACT_QUEUED } from "./constants";
import { Emitter } from "./emitter";
import { link } from "./link";

type Layers = Partial<Record<Priority, OverviewItem[]>>;
export type FeedSnapshot = {
  loaded: boolean;
  generatedAt: number;
  layers: Layers;
  tasks: Record<string, TaskSnapshot>;
  agents: AgentStatus[];
  // taskId -> 已提交还没回执的选项
  pending: Record<string, string>;
  notice: string | null;
  version: number;
};

const EMPTY: FeedSnapshot = { loaded: false, generatedAt: 0, layers: {}, tasks: {}, agents: [], pending: {}, notice: null, version: 0 };

// 总览与 Agent 栏共用: overview 快照打底, 之后 ev / task / agents 帧实时合并 (对照安卓 FeedState.kt)
class FeedStore {
  readonly changed = new Emitter<void>();
  private snap: FeedSnapshot = EMPTY;
  private actions = new Map<string, string>();

  snapshot = (): FeedSnapshot => this.snap;

  attach(): () => void {
    const off = link.frames.on((f) => {
      switch (f.t) {
        case "welcome":
          // 重连后服务端状态可能已变, 重新要一份快照
          link.write({ t: "overview" });
          return;
        case "overview":
          return this.apply(f.overview as Overview);
        case "ev":
          return this.merge(f.ev as Envelope);
        case "task":
          return this.putTask(f.task as TaskSnapshot);
        case "agents":
          return Array.isArray(f.agents) && this.set({ agents: f.agents as AgentStatus[] });
        case "act_ok":
          return this.settle(String(f.aid), f.state === ACT_QUEUED ? TXT_ACT_QUEUED : null);
        case "err":
          return typeof f.aid === "string" && this.settle(f.aid, `${TXT_ACT_FAILED}: ${String(f.text ?? "")}`);
      }
    });
    if (link.state === "online") link.write({ t: "overview" });
    return () => {
      off();
      this.actions.clear();
      this.snap = { ...EMPTY, version: this.snap.version + 1 };
    };
  }

  // 回答等待确认的任务; 返回 false 表示没发出去
  act(taskId: string, kind: UserActionKind, option: string | undefined, confirm: boolean): boolean {
    const aid = `a_${crypto.randomUUID().replace(/-/g, "").slice(0, AID_LENGTH)}`;
    const frame: Record<string, unknown> = { t: "act", aid, taskId, kind };
    if (option) frame.option = option;
    if (confirm) frame.confirm = true;
    if (!link.write(frame)) {
      this.set({ notice: TXT_ACT_OFFLINE });
      return false;
    }
    this.actions.set(aid, taskId);
    this.set({ pending: { ...this.snap.pending, [taskId]: option ?? kind }, notice: null });
    return true;
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }

  private apply(o: Overview): void {
    const tasks: Record<string, TaskSnapshot> = {};
    for (const t of o.tasks) tasks[t.id] = t;
    this.set({ loaded: true, generatedAt: o.generatedAt, layers: o.layers, tasks });
  }

  private putTask(t: TaskSnapshot): void {
    this.set({ tasks: { ...this.snap.tasks, [t.id]: t } });
  }

  // 同 id 整体替换; 已恢复的 "需要我" 移到 "正在发生"; 每层只留最新若干条
  private merge(ev: Envelope): void {
    const task = (ev as { task?: TaskSnapshot }).task;
    const tasks = task ? { ...this.snap.tasks, [task.id]: task } : this.snap.tasks;
    if (ev.kind === "metric") return task ? this.set({ tasks }) : undefined;
    const layers: Layers = {};
    for (const [k, v] of Object.entries(this.snap.layers) as [Priority, OverviewItem[]][]) layers[k] = v.filter((it) => it.ev.id !== ev.id);
    if (!ev.deleted) {
      const target: Priority = ev.resolved && ev.priority === "need_me" ? "happening" : ev.priority;
      layers[target] = [{ ev, count: 1, ids: [ev.id] } as OverviewItem, ...(layers[target] ?? [])].slice(0, LAYER_MAX);
    }
    this.set({ layers, tasks });
  }

  private settle(aid: string, notice: string | null): void {
    const taskId = this.actions.get(aid);
    if (!taskId) return;
    this.actions.delete(aid);
    const pending = { ...this.snap.pending };
    delete pending[taskId];
    this.set({ pending, notice });
  }

  private set(p: Partial<FeedSnapshot>): void {
    this.snap = { ...this.snap, ...p, version: this.snap.version + 1 };
    this.changed.emit();
  }
}

export const feed = new FeedStore();
