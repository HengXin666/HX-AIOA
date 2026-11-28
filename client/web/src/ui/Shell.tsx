import { Button } from "@hx/ui/ui/button";
import { MessageSquare, Settings as Gear } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLayout, useLinkState, useUser, type Layout } from "../app/hooks";
import { go, useRoute, type Route } from "../app/router";
import { TXT_PICK_CHAT } from "../core/constants";
import { newVersion } from "../core/version";
import { ChatList } from "./ChatList";
import { Conversation } from "./Conversation";
import { Settings } from "./Settings";
import { UserAvatar } from "./UserAvatar";

const NAV: { route: Route; label: string; icon: ReactNode }[] = [
  { route: { name: "chats" }, label: "消息", icon: <MessageSquare /> },
  { route: { name: "settings" }, label: "设置", icon: <Gear /> },
];

// 电脑三栏 / 中屏图标栏 / 手机单栏; 版式见 docs/design/web-arch.md 第 4 节
export function Shell() {
  const layout = useLayout();
  const route = useRoute();
  const channel = route.name === "chat" ? route.channel : null;
  const list = route.name === "settings" ? <Settings /> : <ChatList active={channel} />;
  const detail = channel ? <Conversation key={channel} channel={channel} narrow={layout === "narrow"} /> : <Empty />;

  if (layout === "narrow") {
    return (
      <div className="flex h-full flex-col bg-background">
        <UpdateBar />
        <div className="min-h-0 flex-1">{channel ? detail : list}</div>
        {!channel && <BottomNav route={route} />}
      </div>
    );
  }
  return (
    <div className="flex h-full bg-background">
      <Rail layout={layout} route={route} />
      <section className="flex w-[340px] shrink-0 flex-col border-r border-border">{list}</section>
      <main className="flex min-w-0 flex-1 flex-col">
        <UpdateBar />
        {route.name === "settings" ? <Empty /> : detail}
      </main>
    </div>
  );
}

const active = (r: Route, cur: Route) => (r.name === "chats" ? cur.name !== "settings" : r.name === cur.name);

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
          variant={active(n.route, route) ? "secondary" : "ghost"}
          size={wide ? "default" : "icon"}
          className={wide ? "justify-start" : ""}
          aria-label={n.label}
          onClick={() => go(n.route)}
        >
          {n.icon}
          {wide && n.label}
        </Button>
      ))}
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
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs [&_svg]:size-5 ${active(n.route, route) ? "text-foreground" : "text-muted-foreground"}`}
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
