import type { CSSProperties, ReactNode } from "react";
import { IconTile } from "../shell/nav";

// 总览的面板外壳: 有色图标块 + 标题 + 计数, 右上角动作; 标题栏与内容之间一条细线
export function Panel({ title, icon, tone = TONE.muted, count, hint, action, className, children, id }: { title: ReactNode; icon?: ReactNode; tone?: string; count?: number; hint?: ReactNode; action?: ReactNode; className?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={`flex min-w-0 flex-col rounded-xl border border-border bg-card ${className ?? ""}`}>
      <header className="flex min-h-11 items-center gap-2.5 border-b border-border/70 px-3 py-2">
        {icon && (
          <IconTile tone={tone} size="sm">
            {icon}
          </IconTile>
        )}
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {count !== undefined && count > 0 && <span className="rounded-md bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{count}</span>}
        {hint && <span className="min-w-0 truncate text-xs text-muted-foreground">{hint}</span>}
        {action && <span className="ml-auto flex shrink-0 items-center gap-1">{action}</span>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">{children}</div>
    </section>
  );
}

// 没内容时一行灰字, 不占大块空白
export function Quiet({ children }: { icon?: ReactNode; children: ReactNode }) {
  return <p className="px-2 py-3 text-xs text-muted-foreground">{children}</p>;
}

// 一项事实: 数字 + 说明, 横排紧凑, 颜色只上在数字上
export function Fact({ value, label, color }: { value: ReactNode; label: string; color?: string }) {
  return (
    <span className="flex items-baseline gap-1 text-xs text-muted-foreground">
      <span className="text-sm font-semibold text-foreground tabular-nums" style={color ? ({ color } as CSSProperties) : undefined}>
        {value}
      </span>
      {label}
    </span>
  );
}

export const TONE = { primary: "var(--info)", accent: "var(--chart-2)", success: "var(--success)", warning: "var(--warning)", danger: "var(--destructive)", info: "var(--info)", muted: "var(--muted-foreground)" } as const;
