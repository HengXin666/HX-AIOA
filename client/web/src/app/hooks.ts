import { useEffect, useState, useSyncExternalStore } from "react";
import { authChanged, currentUser } from "../core/auth";
import { chats } from "../core/chats";
import { BP_MID, BP_WIDE } from "../core/constants";
import { link } from "../core/link";

export const useChats = () => useSyncExternalStore((fn) => chats.changed.on(fn), chats.snapshot);
export const useLinkState = () => useSyncExternalStore((fn) => link.states.on(fn), () => link.state);
export const useUser = () => useSyncExternalStore((fn) => authChanged.on(fn), currentUser);

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
