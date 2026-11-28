import { useEffect, useSyncExternalStore } from "react";
import type { HostConn } from "./conn";
import { conn, connsChanged, connsVersion } from "./conns";
import { agHub } from "./hub";
import { pairsChanged, pairsVersion } from "./pairs";
import type { SessionStore } from "./session";

export const useAgHub = () => useSyncExternalStore((fn) => agHub.changed.on(fn), agHub.snapshot);
export const usePairs = () => useSyncExternalStore((fn) => pairsChanged.on(fn), pairsVersion);
export const useConnsVersion = () => useSyncExternalStore((fn) => connsChanged.on(fn), connsVersion);

export function useConn(host: string): ReturnType<HostConn["snapshot"]> & { c: HostConn } {
  const c = conn(host);
  const snap = useSyncExternalStore((fn) => c.changed.on(fn), c.snapshot);
  return { ...snap, c };
}

export function useSession(host: string, sid: string): ReturnType<SessionStore["snapshot"]> & { s: SessionStore } {
  const s = conn(host).session(sid);
  const snap = useSyncExternalStore((fn) => s.changed.on(fn), s.snapshot);
  return { ...snap, s };
}

// 打开会话页时附着, 离开时解除; 连接重建后由连接主人按 seq 补
export function useAttach(host: string, sid: string): void {
  useEffect(() => conn(host).attach(sid), [host, sid]);
}
