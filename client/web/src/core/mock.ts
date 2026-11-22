import type { TaskSnapshot, UserActionInput } from "@hx-aioa/protocol";
import { MOCK_TICK_MS } from "../constants";
import type { Backend } from "./backend";
import { backupEvent, ERROR_BIND, MOCK_SPACES, MOCK_SUBJECTS, mockEvents, mockTasks, randomEvent } from "./mockData";
import type { Store } from "./store";

const { NAS, VPS, ROUTER, BACKUP, HOME } = MOCK_SUBJECTS;
const HISTORY = 60;
const STEP_MS = 10_000;
const UNITS = { cpu: "%", mem: "%", temp: "°C", net: "MB/s", humidity: "%", size: "GB" };

type Walk = Record<string, number>;

// 模拟服务端推送: 指标定时刷新, 偶发事件, 任务推进, 响应用户动作
export class MockBackend implements Backend {
  readonly mode = "mock";
  private walk: Record<string, Walk> = {
    [NAS]: { cpu: 35, mem: 62, temp: 41 },
    [VPS]: { cpu: 18, mem: 44, net: 3.2 },
    [HOME]: { temp: 23.5, humidity: 48 },
  };
  private ticks = 0;

  constructor(private readonly store: Store) {}

  start(): void {
    const s = this.store;
    window.setTimeout(() => {
      MOCK_SPACES.forEach((sp) => s.upsertSpace(structuredClone(sp)));
      const now = Date.now();
      for (const [subject, w] of Object.entries(this.walk)) {
        const pts = Array.from({ length: HISTORY }, (_, i) => ({ ts: now - (HISTORY - i) * STEP_MS, values: this.step(w) }));
        s.ingestPoints(subject, pts, UNITS, subject === NAS ? { cpu: { warn: 70, crit: 90 } } : undefined);
      }
      const up = (subject: string, v: number) => s.ingestPoints(subject, [{ ts: now, values: { up: v } }]);
      up(NAS, 1);
      up(VPS, 1);
      up(ROUTER, 0);
      // 备份面板按 60 秒周期声明, 数据停在 5 分钟前, 用来展示 "已过期"
      s.ingestPoints(BACKUP, [{ ts: now - 5 * 60_000, values: { size: 2.4 } }], UNITS);
      s.setError({ subject: ERROR_BIND.subject, field: ERROR_BIND.field }, ERROR_BIND.text);
      mockEvents().forEach((e) => s.ingest(e));
      s.ingest(backupEvent());
      for (const { task, log } of mockTasks()) {
        s.setLog(task.id, log);
        s.ingestTask(task);
      }
      s.setLink(true);
      s.setReady(true);
    }, 400);
    window.setInterval(() => this.tick(), MOCK_TICK_MS);
  }

  watch(): void {}

  sendAct(a: UserActionInput): boolean {
    window.setTimeout(() => this.respond(a), 600);
    return true;
  }

  private step(w: Walk): Record<string, number> {
    for (const k of Object.keys(w)) {
      const v = w[k]! + (Math.random() - 0.5) * (k === "net" ? 0.8 : 4);
      w[k] = Math.round(Math.max(1, Math.min(k === "temp" ? 60 : 98, v)) * 10) / 10;
    }
    return { ...w };
  }

  private tick(): void {
    this.ticks++;
    const now = Date.now();
    for (const [subject, w] of Object.entries(this.walk)) this.store.ingestPoints(subject, [{ ts: now, values: this.step(w) }]);
    if (this.ticks % 10 === 0) this.store.ingest(randomEvent());
    const t = this.store.tasks.get("research-7");
    if (t && t.state === "running") this.advance(t);
  }

  private advance(t: TaskSnapshot): void {
    const progress = Math.min(1, (t.progress ?? 0) + 0.03);
    const done = progress >= 1;
    this.store.ingestTask({ ...t, progress, state: done ? "done" : "running", step: done ? undefined : `已归纳 ${Math.round(progress * 5)} 条`, result: done ? "整理完成, 已生成报告" : undefined, updated: Date.now() });
    if (done) this.say(t.id, "整理完成, 报告已放进 值得一看。");
  }

  private say(taskId: string, text: string, role: "agent" | "system" = "agent"): void {
    this.store.appendLog(taskId, { ts: Date.now(), role, kind: "say", text });
  }

  private respond(a: UserActionInput): void {
    const s = this.store;
    if (a.taskId.startsWith("button:")) {
      const id = `cmd-${Date.now()}`;
      s.ingestTask({ id, agent: "dsh", title: `执行 ${a.text}`, state: "running", progress: 0.1, step: "已收到指令", created: Date.now(), updated: Date.now() });
      this.say(id, `收到按钮指令 ${a.text}, 开始执行。`);
      return;
    }
    const t = s.tasks.get(a.taskId);
    if (!t) return;
    if (a.kind === "approve" || a.kind === "reject" || a.kind === "reply") {
      const ok = a.kind !== "reject";
      s.ingestTask({ ...t, state: ok ? "running" : "cancelled", prompt: undefined, progress: ok ? 0.8 : t.progress, step: ok ? "切换流量中" : undefined, updated: Date.now() });
      this.say(t.id, ok ? "收到, 正在切换流量。" : "已取消切换, 保持旧版本。");
      if (ok) window.setTimeout(() => s.ingestTask({ ...s.tasks.get(t.id)!, state: "done", progress: 1, result: "已全部切换", updated: Date.now() }), 3000);
    } else if (a.kind === "cancel") {
      s.ingestTask({ ...t, state: "cancelled", updated: Date.now() });
      this.say(t.id, "任务已取消。", "system");
    } else {
      this.say(t.id, `关于 "${a.text}": 这是模拟回答, 真实 Agent 会结合任务上下文回复。`);
    }
  }
}
