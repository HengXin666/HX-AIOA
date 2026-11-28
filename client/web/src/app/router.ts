import { useSyncExternalStore } from "react";

// hash 路由: 每次导航都是 "/" 这一个静态文件, 不进 Worker。格式 #/<栏>/<段>/<段>, 段做 URI 编码
// 栏与安卓底栏一致; 各栏自己解析后面的段 (子页), 页面 id 对照 docs/design/ui-spec/pages.json
export const AREAS = ["overview", "chat", "agent", "res", "me"] as const;
export type AreaId = (typeof AREAS)[number];
export type Loc = { area: AreaId; path: string[] };

const isArea = (s: string): s is AreaId => (AREAS as readonly string[]).includes(s);

export function parseLoc(hash: string): Loc {
  const segs = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const head = segs[0] ?? "";
  if (isArea(head)) return { area: head, path: segs.slice(1) };
  // 旧地址: #/c/<群>, #/settings
  if (head === "c") return { area: "chat", path: segs.slice(1) };
  if (head === "settings") return { area: "me", path: [] };
  return { area: "overview", path: [] };
}

export const link = (area: AreaId, ...path: string[]): string => `#/${[area, ...path].map(encodeURIComponent).join("/")}`;

export function nav(area: AreaId, ...path: string[]): void {
  location.hash = link(area, ...path);
}

// 返回上一级: 同栏去掉最后一段, 不依赖浏览器历史 (直接打开子页链接也能回)
export function up(loc: Loc): void {
  nav(loc.area, ...loc.path.slice(0, -1));
}

const subscribe = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};

export function useLoc(): Loc {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parseLoc(hash);
}

// 下面是旧接口, 已有页面还在用; 新代码用 link / nav / useLoc
export type ResTab = "hosts" | "cf" | "gh";
export type Route =
  | { name: "chats" }
  | { name: "chat"; channel: string }
  | { name: "overview" }
  | { name: "settings" }
  | { name: "res"; tab: ResTab; id?: string };

export function href(r: Route): string {
  switch (r.name) {
    case "chats":
      return link("chat");
    case "chat":
      return link("chat", r.channel);
    case "settings":
      return link("me");
    case "res":
      return r.id ? link("res", r.tab, r.id) : link("res", r.tab);
    default:
      return link("overview");
  }
}

export function go(r: Route): void {
  location.hash = href(r);
}

export function useRoute(): Route {
  const loc = useLoc();
  if (loc.area === "chat") return loc.path[0] ? { name: "chat", channel: loc.path[0] } : { name: "chats" };
  if (loc.area === "me") return { name: "settings" };
  if (loc.area === "res") {
    const tab = (["hosts", "cf", "gh"] as const).find((t) => t === loc.path[0]) ?? "hosts";
    return { name: "res", tab, id: loc.path[1] };
  }
  return { name: "overview" };
}
