import { Button } from "@hx/ui/ui/button";
import { Spin } from "@hx/ui/ui/spin";
import { LayoutDashboard, MessageSquare, Server, Settings as Gear } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { setPane, useLayout, useLinkState, usePane, useUser, type Layout } from "../app/hooks";
import { go, useRoute, type Route } from "../app/router";
import { chats } from "../core/chats";
import { TXT_PICK_CHAT } from "../core/constants";
import { newVersion } from "../core/version";
import { ChatList } from "./ChatList";
import { Conversation } from "./Conversation";
import { UserAvatar } from "./UserAvatar";

const Settings = lazy(() => import("./Settings"));
const Overview = lazy(() => import("./Overview"));
const Resources = lazy(() => import("./resources/Resources"));
const CommandPalette = lazy(() => import("./CommandPalette"));
const InspectorPane = lazy(() => import("./Inspector").then((m) => ({ default: m.InspectorPane })));
const InspectorSheet = lazy(() => import("./Inspector").then((m) => ({ default: m.InspectorSheet })));

type Nav = { name: Route["name"]; route: Route; label: string; icon: ReactNode };
const NAV: Nav[] = [
  { name: "chats", route: { name: "chats" }, label: "消息", icon: <MessageSquare /> },
  { name: "overview", route: { name: "overview" }, label: "总览", icon: <LayoutDashboard /> },
  { name: "res", route: { name: "res", tab: "hosts" }, label: "资源", icon: <Server /> },
  { name: "settings", route: { name: "settings" }, label: "设置", icon: <Gear /> },
];
const isActive = (n: Nav, cur: Route) => (n.name === "chats" ? cur.name === "chats" || cur.name === "chat" : n.name === cur.name);

// 电脑三栏 (+ 检查栏) / 中屏图标栏 + 右抽屉 / 手机单栏 + 底栏; 版式见 docs/design/web-arch.md 第 4 节
export function Shell() {
  const layout = useLayout();
  const route = useRoute();
  const pane = usePane();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const channel = route.name === "chat" ? route.channel : null;
  const paneOpen = layout === "wide" ? pane : drawer;
  const togglePane = () => (layout === "wide" ? setPane(!pane) : setDrawer(!drawer));

  useEffect(() => setDrawer(false), [channel, layout]);
  useHotkeys(channel, () => setPalette(true), () => (layout === "wide" ? setPane(false) : setDrawer(false)));

  const page = route.name === "settings" ? <Settings /> : route.name === "overview" ? <Overview /> : route.name === "res" ? <Resources route={route} layout={layout} /> : null;
  const detail = channel ? <Conversation key={channel} channel={channel} narrow={layout === "narrow"} pane={paneOpen} onPane={togglePane} /> : <Empty />;
  const overlays = (
    <Suspense fallback={null}>
      {palette && <CommandPalette open={palette} onOpenChange={setPalette} />}
      {channel && layout !== "wide" && drawer && <InspectorSheet channel={channel} open={drawer} side={layout === "mid" ? "right" : "bottom"} onClose={() => setDrawer(false)} />}
    </Suspense>
  );

  if (layout === "narrow") {
    return (
      <div className="flex h-full flex-col bg-background">
        <UpdateBar />
        <div className="min-h-0 flex-1">{channel ? detail : page ? <Lazy>{page}</Lazy> : <ChatList active={null} />}</div>
        {!channel && <BottomNav route={route} />}
        {overlays}
      </div>
    );
  }
  return (
    <div className="flex h-full bg-background">
      <Rail layout={layout} route={route} />
      {page ? (
        <main className="flex min-w-0 flex-1 flex-col">
          <UpdateBar />
          <Lazy>{page}</Lazy>
        </main>
      ) : (
        <>
          <section className="flex w-[340px] shrink-0 flex-col border-r border-border">
            <ChatList active={channel} />
          </section>
          <main className="flex min-w-0 flex-1 flex-col">
            <UpdateBar />
            {detail}
          </main>
          {channel && layout === "wide" && pane && (
            <Suspense fallback={null}>
              <InspectorPane channel={channel} onClose={() => setPane(false)} />
            </Suspense>
          )}
        </>
      )}
      {overlays}
    </div>
  );
}

// Ctrl/⌘+K 命令面板, Alt+↑/↓ 切会话, Esc 关检查栏 (输入框里的 Esc 先给输入框)
function useHotkeys(channel: string | null, openPalette: () => void, closePane: () => void): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return openPalette();
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const list = chats.ordered();
        if (!list.length) return;
        e.preventDefault();
        const i = list.findIndex((c) => c.channel === channel);
        const j = i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        return go({ name: "chat", channel: list[j]!.channel });
      }
      if (e.key === "Escape" && !e.defaultPrevented) closePane();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [channel, openPalette, closePane]);
}

function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Spin mode="fixed" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function Rail({ layout, route }: { layout: Layout; route: Route }) {
  const user = useUser();
  const state = useLinkState();
  const wide = layout === "wide";
  return (
    <nav className={`flex shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-2 ${wide ? "w-[220px]" : "w-16 items-center"}`}>
      <div className={`mb-2 flex items-center gap-2 p-2 ${wide ? "" : "justify-center"}`}>
        <UserAvatar id={user?.avatar} name={user?.display ?? ""} online={state === "online"} />
        {wide && <span className="truncate text-sm font-medium text-foreground">{user?.display}</span>}
      </div>
      {NAV.map((n) => (
        <Button
          key={n.label}
          variant={isActive(n, route) ? "secondary" : "ghost"}
          size={wide ? "default" : "icon"}
          className={wide ? "justify-start" : ""}
          aria-label={n.label}
          title={wide ? undefined : n.label}
          onClick={() => go(n.route)}
        >
          {n.icon}
          {wide && n.label}
        </Button>
      ))}
      {wide && <p className="mt-auto px-2 text-xs text-muted-foreground">Ctrl+K 搜索</p>}
    </nav>
  );
}

function BottomNav({ route }: { route: Route }) {
  return (
    <nav className="safe-bottom flex border-t border-border bg-sidebar">
      {NAV.map((n) => (
        <button
          key={n.label}
          type="button"
          onClick={() => go(n.route)}
          className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs [&_svg]:size-5 ${isActive(n, route) ? "text-foreground" : "text-muted-foreground"}`}
        >
          {n.icon}
          {n.label}
        </button>
      ))}
    </nav>
  );
}

function Empty() {
  return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{TXT_PICK_CHAT}</div>;
}

function UpdateBar() {
  const [show, setShow] = useState(false);
  useEffect(() => newVersion.on(() => setShow(true)), []);
  if (!show) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-2 text-sm">
      <span className="text-foreground">有新版本</span>
      <Button size="sm" onClick={() => location.reload()}>
        刷新
      </Button>
    </div>
  );
}
