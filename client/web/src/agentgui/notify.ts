import { useEffect } from "react";
import { STATE_LABEL, STORAGE_AG_NOTIFY } from "./constants";
import { connsChanged, knownConn } from "./conns";
import { allPairs } from "./pairs";

// 与 t3code 一样: 页面不在前台时, 会话跑完, 等你或出错弹一条本机通知; 只在这台设备上, 不经服务端
export const notifyOn = (): boolean => localStorage.getItem(STORAGE_AG_NOTIFY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";

export async function setNotify(on: boolean): Promise<boolean> {
  if (!on) {
    localStorage.setItem(STORAGE_AG_NOTIFY, "0");
    return false;
  }
  if (typeof Notification === "undefined") return false;
  const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  localStorage.setItem(STORAGE_AG_NOTIFY, p === "granted" ? "1" : "0");
  return p === "granted";
}

const DONE = new Set(["idle", "waiting", "error"]);
const BUSY = new Set(["running", "starting"]);

export function useTurnNotify(link: (host: string, sid: string) => string): void {
  useEffect(() => {
    const last = new Map<string, string>();
    const scan = () => {
      for (const p of allPairs()) {
        for (const s of knownConn(p.host)?.snapshot().sessions ?? []) {
          const k = `${p.host}/${s.id}`;
          const prev = last.get(k);
          last.set(k, s.state);
          if (!prev || !BUSY.has(prev) || !DONE.has(s.state)) continue;
          if (document.visibilityState === "visible" || !notifyOn()) continue;
          const n = new Notification(`${s.title || "会话"}: ${STATE_LABEL[s.state] ?? s.state}`, { body: `${s.agent} · ${p.host}`, tag: k, silent: s.state === "idle" });
          n.onclick = () => {
            window.focus();
            location.hash = link(p.host, s.id);
            n.close();
          };
        }
      }
    };
    scan();
    return connsChanged.on(scan);
  }, [link]);
}
