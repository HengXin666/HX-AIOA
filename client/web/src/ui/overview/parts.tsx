import { Card } from "@hx/ui/ui/card";
import { Empty, EmptyMedia, EmptyTitle } from "@hx/ui/ui/empty";
import { m } from "motion/react";
import type { ReactNode } from "react";

// 总览的公共件 (对照安卓 kit: Panel, SectionTitle, Ring, Meter, CountUp)

export const TONE = {
  primary: "var(--info)",
  accent: "var(--chart-2)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--destructive)",
  info: "var(--info)",
  muted: "var(--muted-foreground)",
} as const;
export type Tone = keyof typeof TONE;

// 颜色的淡底: 图标方块, 指标块, 选中行都用它
export const tint = (color: string, pct = 14) => `color-mix(in oklab, ${color} ${pct}%, transparent)`;

/** 一块区域: 左上带色的图标方块 + 标题 + 计数, 下一行说明, 右上角动作。 */
export function Section({
  title,
  icon,
  tone = "primary",
  count,
  hint,
  action,
  className,
  children,
}: {
  title: ReactNode;
  icon: ReactNode;
  tone?: Tone;
  count?: number;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={`h-full min-w-0 gap-0 overflow-hidden py-0 ${className ?? ""}`}>
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        {icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4" style={{ background: tint(TONE[tone]), color: TONE[tone] }}>
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {title}
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">
                {count}
              </span>
            )}
          </h2>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">{children}</div>
    </Card>
  );
}

// 旧名字: 服务器 / 开发看板与星标待办还在用
export const Panel = (p: Omit<Parameters<typeof Section>[0], "icon"> & { icon?: ReactNode }) => <Section {...p} icon={p.icon ?? null} />;

/** 卡片里没内容: 图标 + 一句话, 依次浮上来, 占住高度。 */
export function Quiet({ icon, children, tone = "muted" }: { icon?: ReactNode; children: ReactNode; tone?: "success" | "muted" }) {
  return (
    <Empty size="compact" variant="muted" animate="rise" className="flex-1 py-8">
      <EmptyMedia variant="icon" tone={tone}>
        {icon}
      </EmptyMedia>
      <EmptyTitle as="p" className="text-sm font-normal text-muted-foreground">
        {children}
      </EmptyTitle>
    </Empty>
  );
}

/** 一项事实数据: 整数直接显示, 不做滚动 (滚动中间帧会出小数)。 */
export function Feat({ value, label, color }: { value: ReactNode; label: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5" style={{ background: tint(color, 12) }}>
      <span className="text-xl font-semibold tabular-nums" style={{ color }}>
        {value ?? "-"}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

const RING_R = 22;
const RING_W = 5;
const RING_BOX = (RING_R + RING_W) * 2;

/** 进度环 (对照安卓 kit Ring): 弧从 0 画到 value, 中间放头像或图标。 */
export function Ring({ value, color, delay = 0, children }: { value: number; color: string; delay?: number; children?: ReactNode }) {
  const c = RING_R + RING_W;
  return (
    <div className="relative grid size-[54px] shrink-0 place-items-center">
      <svg viewBox={`0 0 ${RING_BOX} ${RING_BOX}`} className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx={c} cy={c} r={RING_R} fill="none" stroke="var(--muted)" strokeWidth={RING_W} />
        <m.circle
          cx={c}
          cy={c}
          r={RING_R}
          fill="none"
          stroke={color}
          strokeWidth={RING_W}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: Math.max(0.001, Math.min(1, value)), opacity: value > 0 ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 60, damping: 18, delay }}
        />
      </svg>
      <span className="relative grid size-9 place-items-center overflow-hidden rounded-full">{children}</span>
    </div>
  );
}

const SEGMENTS = 20;

/** 分段负载条 (对照安卓 kit Meter): 亮起的格子依次点亮, 超过 80% 变黄, 超过 90% 变红。 */
export function Meter({ pct, color, delay = 0 }: { pct: number | undefined; color: string; delay?: number }) {
  const on = pct === undefined ? 0 : Math.round((Math.min(100, Math.max(0, pct)) / 100) * SEGMENTS);
  const hot = pct !== undefined && pct >= 90 ? TONE.danger : pct !== undefined && pct >= 80 ? TONE.warning : color;
  return (
    <div className="flex h-2 flex-1 gap-[2px]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === undefined ? undefined : Math.round(pct)}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <m.span
          key={i}
          className="flex-1 rounded-[2px]"
          initial={{ opacity: 0.25, scaleY: 0.6 }}
          animate={{ opacity: i < on ? 1 : 0.18, scaleY: 1 }}
          transition={{ delay: delay + i * 0.018, duration: 0.25 }}
          style={{ background: i < on ? hot : "var(--muted-foreground)" }}
        />
      ))}
    </div>
  );
}

// 一项事实, 横排紧凑: 数字 + 说明
export function Fact({ value, label, color }: { value: ReactNode; label: string; color?: string }) {
  return (
    <span className="flex items-baseline gap-1 text-xs text-muted-foreground">
      <span className="text-sm font-semibold text-foreground tabular-nums" style={color ? { color } : undefined}>
        {value ?? "-"}
      </span>
      {label}
    </span>
  );
}
