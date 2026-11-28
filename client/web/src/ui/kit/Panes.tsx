import { Button } from "@hx/ui/ui/button";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import type { Layout } from "../../app/hooks";

// 栏内版式: 电脑左列表右详情 (宽屏可再加检查栏), 手机只显示其一; 对应安卓 "栏根页 + 子页推入"
export function TwoPane({ layout, list, detail, aside, showDetail, listWidth = 340 }: { layout: Layout; list: ReactNode; detail: ReactNode; aside?: ReactNode; showDetail: boolean; listWidth?: number }) {
  if (layout === "narrow") return <div className="flex h-full min-h-0 w-full flex-col">{showDetail ? detail : list}</div>;
  return (
    <div className="flex h-full min-h-0 w-full">
      <section style={{ width: listWidth }} className="flex shrink-0 flex-col border-r border-border">
        {list}
      </section>
      <div className="flex min-w-0 flex-1 flex-col">{detail}</div>
      {aside}
    </div>
  );
}

// 页头: 手机子页带返回; 电脑详情栏的返回只在多层时出现
export function PageHeader({ title, sub, back, actions }: { title: ReactNode; sub?: ReactNode; back?: () => void; actions?: ReactNode }) {
  return (
    <header className="flex min-h-12 items-center gap-2 border-b border-border px-3 py-2">
      {back && (
        <Button size="icon-sm" variant="ghost" aria-label="返回" onClick={back}>
          <ArrowLeft />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">{children}</div>;
}
