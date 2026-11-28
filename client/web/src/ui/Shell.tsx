import { Button } from "@hx/ui/ui/button";
import { Spin } from "@hx/ui/ui/spin";
import { Bot, LayoutDashboard, MessageSquare, Server, UserRound } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useLayout, useLinkState, useMyFace, useUser, type Layout } from "../app/hooks";
import { link, useLoc, type AreaId, type Loc } from "../app/router";
import { newVersion } from "../core/version";
import { UserAvatar } from "./UserAvatar";

export type AreaProps = { loc: Loc; layout: Layout };

// 每个栏一个包, 进栏才加载; 栏内的列表 / 详情 / 检查栏由栏自己排 (见 ui/kit/Panes.tsx)
const PAGES: Record<AreaId, ComponentType<AreaProps>> = {
  overview: lazy(() => import("./overview")),
  chat: lazy(() => import("./chat")),
  agent: lazy(() => import("./agent")),
  res: lazy(() => import("./res")),
  me: lazy(() => import("./me")),
};
const CommandPalette = lazy(() => import("./CommandPalette"));

const NAV: { area: AreaId; label: string; icon: ReactNode }[] = [
  { area: "overview", label: "总览", icon: <LayoutDashboard /> },
  { area: "chat", label: "消息", icon: <MessageSquare /> },
  { area: "agent", label: "Agent", icon: <Bot /> },
  { area: "res", label: "资源", icon: <Server /> },
  { area: "me", label: "我的", icon: <UserRound /> },
];

// 电脑: 左侧栏 + 栏内容; 手机: 栏内容 + 底栏 (进子页时底栏隐藏, 与安卓一致)
export function Shell() {
  const layout = useLayout();
  const loc = useLoc();
  const [palette, setPalette] = useState(false);
  usePaletteKey(() => setPalette(true));
  const Page = PAGES[loc.area];
  const body = (
    <Lazy>
      <Page loc={loc} layout={layout} />
    </Lazy>
  );
  const overlays = <Suspense fallback={null}>{palette && <CommandPalette open={palette} onOpenChange={setPalette} />}</Suspense>;

  if (layout === "narrow") {
    return (
      <div className="flex h-full flex-col bg-background">
        <UpdateBar />
        <div className="min-h-0 flex-1">{body}</div>
        {loc.path.length === 0 && <BottomNav area={loc.area} />}
        {overlays}
      </div>
    );
  }
  return (
    <div className="flex h-full bg-background">
      <Rail layout={layout} area={loc.area} />
      <main className="flex min-w-0 flex-1 flex-col">
        <UpdateBar />
        <div className="flex min-h-0 flex-1">{body}</div>
      </main>
      {overlays}
    </div>
  );
}

function usePaletteKey(open: () => void): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open]);
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

function Rail({ layout, area }: { layout: Layout; area: AreaId }) {
  const user = useUser();
  const face = useMyFace();
  const state = useLinkState();
  const wide = layout === "wide";
  return (
    <nav className={`flex shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-2 ${wide ? "w-[200px]" : "w-16 items-center"}`}>
      <a href={link("me")} className={`mb-2 flex items-center gap-2 p-2 ${wide ? "" : "justify-center"}`}>
        <UserAvatar id={face} name={user?.display ?? ""} online={state === "online"} />
        {wide && <span className="truncate text-sm font-medium text-foreground">{user?.display}</span>}
      </a>
      {NAV.map((n) => (
        <Button key={n.area} asChild variant={n.area === area ? "secondary" : "ghost"} size={wide ? "default" : "icon"} className={wide ? "justify-start" : ""}>
          <a href={link(n.area)} aria-label={n.label} title={wide ? undefined : n.label}>
            {n.icon}
            {wide && n.label}
          </a>
        </Button>
      ))}
      {wide && <p className="mt-auto px-2 text-xs text-muted-foreground">Ctrl+K 搜索</p>}
    </nav>
  );
}

function BottomNav({ area }: { area: AreaId }) {
  return (
    <nav className="safe-bottom flex border-t border-border bg-sidebar">
      {NAV.map((n) => (
        <a
          key={n.area}
          href={link(n.area)}
          className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs [&_svg]:size-5 ${n.area === area ? "text-foreground" : "text-muted-foreground"}`}
        >
          {n.icon}
          {n.label}
        </a>
      ))}
    </nav>
  );
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
