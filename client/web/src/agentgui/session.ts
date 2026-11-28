import { Emitter } from "../core/emitter";
import { EMPTY_VIEW, Reducer, type View } from "./reduce";
import type { Card, ContentBlock, JsonRpc, LogItem, Stats } from "./types";

export type SessionSnap = {
  view: View;
  perms: Card[];
  answering: Record<string, true>;
  stats: Stats | null;
  loaded: boolean;
  more: boolean;
  loadingOlder: boolean;
  firstSeq: number;
  lastSeq: number;
  version: number;
};

const EMPTY: SessionSnap = { view: EMPTY_VIEW, perms: [], answering: {}, stats: null, loaded: false, more: false, loadingOlder: false, firstSeq: 0, lastSeq: 0, version: 0 };
const LOCAL_STEP = 0.5;

const promptText = (m: JsonRpc): string => {
  const blocks = (m.params?.prompt as ContentBlock[] | undefined) ?? [];
  return blocks.map((b) => b.text ?? "").join("\n");
};

// 一个会话的原始日志 (按 seq) 与归约后的时间线; 往前翻页或乱序到达时整体重算
export class SessionStore {
  readonly changed = new Emitter<void>();
  private raw: LogItem[] = [];
  private seqs = new Set<number>();
  private reducer = new Reducer();
  private snap: SessionSnap = EMPTY;

  constructor(readonly sid: string) {}

  snapshot = (): SessionSnap => this.snap;

  private set(p: Partial<SessionSnap>): void {
    this.snap = { ...this.snap, ...p, version: this.snap.version + 1 };
    this.changed.emit();
  }

  private emitView(): void {
    const ints = this.raw.filter((x) => Number.isInteger(x.seq));
    this.set({ view: this.reducer.view, firstSeq: ints[0]?.seq ?? 0, lastSeq: ints[ints.length - 1]?.seq ?? 0 });
  }

  private rebuild(): void {
    this.raw.sort((a, b) => a.seq - b.seq);
    this.reducer = new Reducer(this.raw);
  }

  // 本地刚发出的 prompt 先插一条小数 seq 占位, 探针回显同一句话时去掉占位
  private dropEcho(it: LogItem): boolean {
    if (it.m.method !== "session/prompt") return false;
    const text = promptText(it.m);
    const k = this.raw.findIndex((x) => !Number.isInteger(x.seq) && promptText(x.m) === text);
    if (k < 0) return false;
    const local = this.raw[k] as LogItem;
    this.seqs.delete(local.seq);
    this.raw.splice(k, 1);
    return true;
  }

  private insert(items: LogItem[]): boolean {
    let reorder = false;
    for (const it of items) {
      if (this.seqs.has(it.seq)) continue;
      if (this.dropEcho(it)) reorder = true;
      const tail = this.raw[this.raw.length - 1];
      if (tail && tail.seq > it.seq) reorder = true;
      this.seqs.add(it.seq);
      this.raw.push(it);
      if (!reorder) this.reducer.push(it);
    }
    if (reorder) this.rebuild();
    return items.length > 0;
  }

  acp(seq: number, m: JsonRpc, at?: number): void {
    if (this.insert([{ seq, m, at: at ?? Date.now() }])) this.emitView();
  }

  window(from: number, items: LogItem[], more: boolean): void {
    const older = this.snap.loaded && from < this.snap.firstSeq;
    this.insert(items);
    const p: Partial<SessionSnap> = { loaded: true, loadingOlder: false };
    if (older || !this.snap.loaded) p.more = more;
    this.set(p);
    this.emitView();
  }

  localPrompt(m: JsonRpc): void {
    const last = this.raw[this.raw.length - 1]?.seq ?? 0;
    this.insert([{ seq: Math.floor(last) + LOCAL_STEP, m, at: Date.now() }]);
    this.emitView();
  }

  setLoadingOlder(on: boolean): void {
    this.set({ loadingOlder: on });
  }

  permReq(card: Card): void {
    this.set({ perms: [...this.snap.perms.filter((c) => c.rid !== card.rid), card].sort((a, b) => a.at - b.at) });
  }

  permDone(rid: string): void {
    const answering = { ...this.snap.answering };
    delete answering[rid];
    this.set({ perms: this.snap.perms.filter((c) => c.rid !== rid), answering });
  }

  answering(rid: string, on: boolean): void {
    const answering = { ...this.snap.answering };
    if (on) answering[rid] = true;
    else delete answering[rid];
    this.set({ answering });
  }

  stats(s: Stats): void {
    this.set({ stats: { ...this.snap.stats, ...s } });
  }

  // 重连时补帧的起点
  since(): number | undefined {
    return this.snap.loaded ? this.snap.lastSeq : undefined;
  }
}
