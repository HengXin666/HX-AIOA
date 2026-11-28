import { useSyncExternalStore } from "react";
import { Emitter } from "../core/emitter";
import { DIAG_MAX } from "./constants";

// 替代 t3code 的遥测 (OTLP 链路追踪, 后台活动上报, 资源遥测): 只记在这台设备的内存里, 不上报任何服务。
// 会话内容, 路径, 命令一概不记, 只记方法名, 耗时, 结果; 导出由用户自己点。
export type DiagKind = "route" | "ready" | "drop" | "hx" | "acp" | "error";
export type DiagEvent = { at: number; host: string; kind: DiagKind; name: string; ms?: number; ok: boolean; note?: string };

const ring: DiagEvent[] = [];
const frames = new Map<string, { n: number; bytes: number; since: number }>();
const changed = new Emitter<void>();
let version = 0;
let pending = false;

// 高频帧计数不逐条通知, 合成一帧刷新
function bump(): void {
  version++;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    changed.emit();
  });
}

export const diag = {
  log(e: Omit<DiagEvent, "at">): void {
    ring.push({ ...e, at: Date.now() });
    if (ring.length > DIAG_MAX) ring.splice(0, ring.length - DIAG_MAX);
    bump();
  },
  frame(host: string, bytes: number): void {
    const f = frames.get(host) ?? { n: 0, bytes: 0, since: Date.now() };
    f.n++;
    f.bytes += bytes;
    frames.set(host, f);
    bump();
  },
  // 计时: 返回结束函数
  span(host: string, kind: DiagKind, name: string): (ok: boolean, note?: string) => void {
    const t0 = performance.now();
    return (ok, note) => diag.log({ host, kind, name, ok, note, ms: Math.round(performance.now() - t0) });
  },
  events: (): readonly DiagEvent[] => ring,
  frames: (host: string) => frames.get(host),
  clear(): void {
    ring.length = 0;
    frames.clear();
    bump();
  },
  export(): string {
    return JSON.stringify({ v: 1, at: new Date().toISOString(), ua: navigator.userAgent, events: ring, frames: Object.fromEntries(frames) }, null, 2);
  },
};

export type DiagSummary = { connects: number; fails: number; lastReadyMs?: number; hxP50?: number; hxP95?: number; hxErr: number; fps: number; kbps: number };

const pct = (xs: number[], p: number): number | undefined => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

export function summarize(host: string): DiagSummary {
  const es = ring.filter((e) => e.host === host);
  const hx = es.filter((e) => e.kind === "hx" || e.kind === "acp");
  const lat = hx.filter((e) => e.ok && e.ms !== undefined).map((e) => e.ms as number);
  const ready = [...es].reverse().find((e) => e.kind === "ready");
  const f = frames.get(host);
  const secs = f ? Math.max(1, (Date.now() - f.since) / 1000) : 1;
  return {
    connects: es.filter((e) => e.kind === "ready").length,
    fails: es.filter((e) => e.kind === "route" && !e.ok).length,
    lastReadyMs: ready?.ms,
    hxP50: pct(lat, 50),
    hxP95: pct(lat, 95),
    hxErr: hx.filter((e) => !e.ok).length,
    fps: f ? Math.round((f.n / secs) * 10) / 10 : 0,
    kbps: f ? Math.round((f.bytes / 1024 / secs) * 10) / 10 : 0,
  };
}

export const useDiag = (): number =>
  useSyncExternalStore(
    (fn) => changed.on(fn),
    () => version,
  );
