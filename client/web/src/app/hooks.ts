import { useEffect, useState, useSyncExternalStore } from "react";
import { authChanged, currentUser } from "../core/auth";
import { chats } from "../core/chats";
import { BP_MID, BP_WIDE, STORAGE_PANE } from "../core/constants";
import { Emitter } from "../core/emitter";
import { link } from "../core/link";
import { presence } from "../core/presence";
import { resources } from "../core/resources";

export const useChats = () => useSyncExternalStore((fn) => chats.changed.on(fn), chats.snapshot);
export const useLinkState = () => useSyncExternalStore((fn) => link.states.on(fn), () => link.state);
export const useUser = () => useSyncExternalStore((fn) => authChanged.on(fn), currentUser);
export const usePresence = (channel: string) => useSyncExternalStore((fn) => presence.changed.on(fn), () => presence.get(channel));
export const useResources = () => useSyncExternalStore((fn) => resources.changed.on(fn), resources.snapshot);

export type Layout = "wide" | "mid" | "narrow";
const layoutOf = (w: number): Layout => (w >= BP_WIDE ? "wide" : w >= BP_MID ? "mid" : "narrow");

// 只在跨过断点时重渲染, 拖窗口不会每帧触发
export function useLayout(): Layout {
  const [l, setL] = useState(() => layoutOf(window.innerWidth));
  useEffect(() => {
    const qs = [BP_MID, BP_WIDE].map((bp) => matchMedia(`(min-width: ${bp}px)`));
    const on = () => setL(layoutOf(window.innerWidth));
    qs.forEach((q) => q.addEventListener("change", on));
    return () => qs.forEach((q) => q.removeEventListener("change", on));
  }, []);
  return l;
}

// 检查栏开关: 宽屏是右侧一栏 (记住开关), 中屏与手机是抽屉 (每次默认关)
const paneChanged = new Emitter<void>();
let pane = localStorage.getItem(STORAGE_PANE) === "1";
export function setPane(open: boolean): void {
  pane = open;
  localStorage.setItem(STORAGE_PANE, open ? "1" : "0");
  paneChanged.emit();
}
export const usePane = () => useSyncExternalStore((fn) => paneChanged.on(fn), () => pane);

// 页面可见性 (切到别的标签 / 最小化)
export function useVisible(): boolean {
  return useSyncExternalStore(
    (fn) => {
      document.addEventListener("visibilitychange", fn);
      return () => document.removeEventListener("visibilitychange", fn);
    },
    () => document.visibilityState === "visible",
  );
}
