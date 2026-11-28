import { lazy, Suspense } from "react";
import { nav } from "../../app/router";
import { PageHeader } from "../kit/Panes";
import Overview from "./Overview";
import type { AreaProps } from "../Shell";

const DriveView = lazy(() => import("../drive/DriveView"));
const TodoBoard = lazy(() => import("../todo/TodoBoard").then((m) => ({ default: m.TodoBoard })));

// 总览栏 (默认页); #/overview/todo 全屏待办看板 (ov-todoboard), #/overview/drive 网盘 (ov-drive-*)
export default function OverviewArea({ loc }: AreaProps) {
  if (loc.path[0] === "todo") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="待办" back={() => nav("overview")} />
        <Suspense fallback={null}>
          <TodoBoard />
        </Suspense>
      </div>
    );
  }
  if (loc.path[0] === "drive") {
    // #/overview/drive/<目录...>: 目录逐级成段, 刷新与收藏地址都能回到同一目录
    const path = `/${loc.path.slice(1).join("/")}`;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="网盘" back={() => nav("overview")} />
        <Suspense fallback={null}>
          <DriveView path={path} onPath={(p) => nav("overview", "drive", ...p.split("/").filter(Boolean))} />
        </Suspense>
      </div>
    );
  }
  return <Overview />;
}
