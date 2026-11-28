import { METRIC_FIELDS, normalizeMetricValues, type HostCard, type MetricPoint } from "@hx-aioa/protocol";
import { SeriesBuffer } from "../charts/source";
import { METRIC_KEEP } from "./constants";
import { Emitter } from "./emitter";
import { link } from "./link";

type Snapshot = { probes: string[]; hosts: HostCard[]; version: number };

// 探针主体与实时指标: 列表来自 probes / hosts 帧, 指标只在有页面 watch 时由 metric 帧推来
class ResourceStore {
  readonly changed = new Emitter<void>();
  private snap: Snapshot = { probes: [], hosts: [], version: 0 };
  private buffers = new Map<string, SeriesBuffer>();
  private watching: string[] = [];

  snapshot = (): Snapshot => this.snap;

  buffer(subject: string): SeriesBuffer {
    let b = this.buffers.get(subject);
    if (!b) {
      b = new SeriesBuffer(METRIC_KEEP);
      this.buffers.set(subject, b);
    }
    return b;
  }

  attach(): () => void {
    const off = link.frames.on((f) => {
      if (f.t === "probes" && Array.isArray(f.subjects)) this.set({ probes: f.subjects as string[] });
      else if (f.t === "hosts" && Array.isArray(f.hosts)) this.set({ hosts: f.hosts as HostCard[] });
      else if (f.t === "metric" && typeof f.subject === "string" && Array.isArray(f.points)) {
        const pts = (f.points as MetricPoint[]).map((p) => ({ ts: p.ts, values: normalizeMetricValues(p.values) }));
        this.buffer(f.subject).push(pts, f.history === true);
      }
    });
    // 重连后服务端忘了 watch, 由连接持有方补发; 这里只管页面自己的
    return () => {
      off();
      this.watch([]);
      this.buffers.clear();
      this.snap = { probes: [], hosts: [], version: this.snap.version + 1 };
    };
  }

  // 在看的主体整体替换; 离开页面或页面隐藏时传 []
  watch(subjects: string[]): void {
    const key = [...subjects].sort().join("\n");
    if (key === this.watching.join("\n")) return;
    this.watching = [...subjects].sort();
    link.write({ t: "watch", subjects: this.watching });
  }

  private set(p: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...p, version: this.snap.version + 1 };
    this.changed.emit();
  }
}

export const unitOf = (field: string): string => METRIC_FIELDS[field]?.unit ?? "";
export const nameOf = (field: string): string => METRIC_FIELDS[field]?.name ?? field;

export const resources = new ResourceStore();
