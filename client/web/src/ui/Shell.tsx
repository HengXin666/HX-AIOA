import { Button } from "@hx/ui/ui/button";
import { Spin } from "@hx/ui/ui/spin";
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useLayout, type Layout } from "../app/hooks";
import { useLoc, type AreaId, type Loc } from "../app/router";
import { newVersion, reloadFresh } from "../core/version";
import { SidebarInset, SidebarProvider } from "@hx/ui/ui/sidebar";
import { AppSidebar, TopBar } from "./shell/Sidebar";

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

// 电脑: HX-UI 侧栏 + 顶栏 + 栏内容; 手机宽度在 App 层就换成了下载页 (AppGate)
export function Shell() {
  const layout = useLayout();
  const loc = useLoc();
  const [palette, setPalette] = useState(false);
  usePaletteKey(() => setPalette(true));
  const Page = PAGES[loc.area];
  return (
    <SidebarProvider defaultOpen={layout === "wide"} className="h-full min-h-0">
      <AppSidebar area={loc.area} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <UpdateBar />
        <TopBar area={loc.area} onSearch={() => setPalette(true)} />
        <div className="flex min-h-0 flex-1">
          <Lazy>
            <Page loc={loc} layout={layout} />
          </Lazy>
        </div>
      </SidebarInset>
      <Suspense fallback={null}>{palette && <CommandPalette open={palette} onOpenChange={setPalette} />}</Suspense>
    </SidebarProvider>
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

function UpdateBar() {
  const [show, setShow] = useState(false);
  useEffect(() => newVersion.on(() => setShow(true)), []);
  if (!show) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-2 text-sm">
      <span className="text-foreground">有新版本</span>
      <Button size="sm" onClick={() => void reloadFresh()}>
        刷新
      </Button>
    </div>
  );
}
