import { Emitter } from "../core/emitter";

// 时序数据: ts 与各字段按下标对齐, 缺的值为 NaN; 超过上限一次丢掉前面一段 (摊还 O(1)), 不每点 shift
export type SourceChange = "append" | "reset";
const SLACK = 1.25;

export class SeriesBuffer {
  readonly changed = new Emitter<SourceChange>();
  ts: number[] = [];
  private cols = new Map<string, number[]>();

  constructor(private readonly cap: number) {}

  fields(): string[] {
    return [...this.cols.keys()];
  }

  values(key: string): number[] {
    return this.cols.get(key) ?? [];
  }

  // 按时间追加; 早于最后一点的 (历史帧) 走 replace 合并重排
  push(points: { ts: number; values: Record<string, number> }[], reset = false): void {
    if (!points.length) return;
    const lastTs = this.ts[this.ts.length - 1] ?? -Infinity;
    if (reset || points[0]!.ts < lastTs) return this.replace(points);
    for (const p of points) this.append(p.ts, p.values);
    if (this.ts.length > this.cap * SLACK) this.trim();
    this.changed.emit("append");
  }

  clear(): void {
    this.ts = [];
    this.cols.clear();
    this.changed.emit("reset");
  }

  private append(ts: number, values: Record<string, number>): void {
    const n = this.ts.length;
    this.ts.push(ts);
    for (const [k, v] of Object.entries(values)) {
      if (typeof v !== "number") continue;
      let col = this.cols.get(k);
      if (!col) {
        col = new Array<number>(n).fill(NaN);
        this.cols.set(k, col);
      }
      col.push(v);
    }
    for (const col of this.cols.values()) if (col.length < n + 1) col.push(NaN);
  }

  private replace(points: { ts: number; values: Record<string, number> }[]): void {
    const all = new Map<number, Record<string, number>>();
    this.ts.forEach((t, i) => {
      const row: Record<string, number> = {};
      for (const [k, col] of this.cols) if (!Number.isNaN(col[i]!)) row[k] = col[i]!;
      all.set(t, row);
    });
    for (const p of points) all.set(p.ts, { ...all.get(p.ts), ...p.values });
    this.ts = [];
    this.cols.clear();
    for (const t of [...all.keys()].sort((a, b) => a - b).slice(-this.cap)) this.append(t, all.get(t)!);
    this.changed.emit("reset");
  }

  private trim(): void {
    const drop = this.ts.length - this.cap;
    this.ts.splice(0, drop);
    for (const col of this.cols.values()) col.splice(0, drop);
  }
}
