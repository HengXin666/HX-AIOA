import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@hx/ui/ui/card";
import type { ReactNode } from "react";

// 总览的卡片外壳 (对照安卓 kit Panel + SectionTitle): 标题, 计数, 一句说明, 右上角动作; 内容区留白统一
export function Panel({ title, icon, count, hint, action, className, children }: { title: ReactNode; icon?: ReactNode; count?: number; hint?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Card className={`min-w-0 gap-3 py-4 ${className ?? ""}`}>
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
          {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
        </CardTitle>
        {hint && <CardDescription className="text-xs">{hint}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-4">{children}</CardContent>
    </Card>
  );
}

// 卡片里没内容时: 图标 + 一句话, 占住高度, 不让卡片看起来像坏了
export function Quiet({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground [&_svg]:size-5 [&_svg]:opacity-60">
      {icon}
      {children}
    </div>
  );
}

// 一项事实数据: 大数字 + 说明, 底色是它自己的颜色 (对照安卓 Pulse 的 Feat)
export function Feat({ value, label, color }: { value: ReactNode; label: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl px-3 py-2" style={{ background: `color-mix(in oklab, ${color} 12%, transparent)` }}>
      <span className="text-lg font-semibold tabular-nums" style={{ color }}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export const TONE = { primary: "var(--info)", accent: "var(--chart-2)", success: "var(--success)", warning: "var(--warning)", danger: "var(--destructive)", info: "var(--info)", muted: "var(--muted-foreground)" } as const;
