import { lazy, Suspense } from "react";
import { nav } from "../../app/router";
import { PageHeader } from "../kit/Panes";
import Overview from "../Overview";
import type { AreaProps } from "../Shell";

const TodoBoard = lazy(() => import("../todo/TodoBoard").then((m) => ({ default: m.TodoBoard })));

// 总览栏 (默认页); #/overview/todo 是全屏待办看板 (对照安卓 ov-todoboard)
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
  return <Overview />;
}
