import { useSyncExternalStore } from "react";

// hash 路由: 每次导航都是 "/" 这一个静态文件, 不进 Worker, 不需要 SPA 回退配置
export type Route = { name: "chats" } | { name: "chat"; channel: string } | { name: "settings" };

const CHAT = "#/c/";
const SETTINGS = "#/settings";

export function parse(hash: string): Route {
  if (hash.startsWith(CHAT)) return { name: "chat", channel: decodeURIComponent(hash.slice(CHAT.length)) };
  if (hash === SETTINGS) return { name: "settings" };
  return { name: "chats" };
}

export const href = (r: Route): string => (r.name === "chat" ? CHAT + encodeURIComponent(r.channel) : r.name === "settings" ? SETTINGS : "#/");

export function go(r: Route): void {
  location.hash = href(r);
}

const subscribe = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parse(hash);
}
