import { useSyncExternalStore } from "react";

// hash 路由: 每次导航都是 "/" 这一个静态文件, 不进 Worker, 不需要 SPA 回退配置
export type ResTab = "hosts" | "cf" | "gh";
export type Route =
  | { name: "chats" }
  | { name: "chat"; channel: string }
  | { name: "overview" }
  | { name: "settings" }
  | { name: "res"; tab: ResTab; id?: string };

const CHAT = "#/c/";
const SETTINGS = "#/settings";
const OVERVIEW = "#/overview";
const RES = "#/res";
const TAB_PREFIX: Record<ResTab, string> = { hosts: "/h", cf: "/cf", gh: "/gh" };

export function parse(hash: string): Route {
  if (hash.startsWith(CHAT)) return { name: "chat", channel: decodeURIComponent(hash.slice(CHAT.length)) };
  if (hash === SETTINGS) return { name: "settings" };
  if (hash === OVERVIEW) return { name: "overview" };
  if (hash === RES || hash.startsWith(`${RES}/`)) {
    const rest = hash.slice(RES.length);
    for (const tab of Object.keys(TAB_PREFIX) as ResTab[]) {
      const p = TAB_PREFIX[tab];
      if (rest === p) return { name: "res", tab };
      if (rest.startsWith(`${p}/`)) return { name: "res", tab, id: decodeURIComponent(rest.slice(p.length + 1)) };
    }
    return { name: "res", tab: "hosts" };
  }
  return { name: "chats" };
}

export function href(r: Route): string {
  switch (r.name) {
    case "chat":
      return CHAT + encodeURIComponent(r.channel);
    case "settings":
      return SETTINGS;
    case "overview":
      return OVERVIEW;
    case "res":
      return `${RES}${TAB_PREFIX[r.tab]}${r.id ? `/${encodeURIComponent(r.id)}` : ""}`;
    default:
      return "#/";
  }
}

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
