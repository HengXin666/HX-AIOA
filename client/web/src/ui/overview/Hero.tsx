import { Sparkline } from "@hx/ui/data";
import { BorderBeam } from "@hx/ui/effects/border-beam";
import { LiveDot } from "@hx/ui/effects/live-dot";
import { NumberRoll } from "@hx/ui/text/number-roll";
import { SplitText } from "@hx/ui/text/split-text";
import { m } from "motion/react";
import { Activity, BellRing, Bot, MessageSquare, Server } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useAttention, useChats, useFeed, useLinkState, useResources, useUser } from "../../app/hooks";
import { link } from "../../app/router";
import { chats } from "../../core/chats";
import { CLOUD_AGENT_LABEL, LOCALE } from "../../core/constants";
import { hourly, useActivity } from "../shell/activity";
import { Ring, TONE } from "./parts";

const CLOCK_MS = 15_000;
const INT = { maximumFractionDigits: 0 } as const;
// 问候按钟点分段: [起始小时, 说法]
const GREETINGS: [number, string][] = [
  [0, "夜深了"],
  [5, "早上好"],
  [11, "中午好"],
  [13, "下午好"],
  [18, "晚上好"],
  [23, "夜深了"],
];

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

const greetingOf = (h: number) => GREETINGS.reduce((g, [at, text]) => (h >= at ? text : g), GREETINGS[0]![1]);

// 顶部: 问候 + 一句话结论 (逐字浮现) + 时钟与连接状态; 右侧放看板切换等动作
export function Hero({ actions }: { actions?: ReactNode }) {
  const now = useClock();
  const user = useUser();
  const snap = useFeed();
  const att = useAttention();
  const online = useLinkState() === "online";
  const headline = !snap.loaded ? "正在同步今天的动静" : att.total > 0 ? `有 ${att.total} 件事等你处理` : "一切都在掌控之中";
  return (
    <header className="flex flex-wrap items-end gap-x-8 gap-y-4">
      <div className="flex min-w-[min(100%,22rem)] flex-1 flex-col gap-2">
        <m.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span className="num text-foreground/80">{now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}</span>
          <span>{now.toLocaleDateString(LOCALE, { month: "long", day: "numeric", weekday: "long" })}</span>
          <span className="flex items-center gap-1.5">
            <LiveDot tone={online ? "success" : "destructive"} live={online} />
            {online ? "实时同步中" : "未连接, 显示上次同步的数据"}
          </span>
        </m.span>
        <p className="text-sm text-muted-foreground">
          {greetingOf(now.getHours())}
          {user?.display ? `, ${user.display}` : ""}
        </p>
        <SplitText key={headline} text={headline} as="h1" effect="blur" stagger={0.035} duration={0.5} className="ov-headline text-3xl leading-tight 2xl:text-4xl 4xl:text-5xl" />
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// 指标带: 五块, 大数字逐位滚动; 需要我有事时整块呼吸并带一圈流光
export function Kpis({ onNeedMe }: { onNeedMe: () => void }) {
  const att = useAttention();
  const snap = useFeed();
  const { hosts, probes } = useResources();
  const events = useActivity();
  useChats();
  const hours = useMemo(() => hourly(events), [events]);
  const tasks = Object.values(snap.tasks);
  const running = tasks.filter((t) => t.state === "running").length;
  const metas = chats.ordered();
  const unread = metas.reduce((n, c) => n + (c.muted ? 0 : Math.max(0, chats.unread(c))), 0);
  const groups = metas.filter((c) => c.agents?.length).length;
  const agents = metas.reduce((n, c) => n + (c.agents?.length ?? 0), 0);
  const live = new Set(probes);
  const up = hosts.filter((h) => live.has(h.subject) || h.online).length;
  const today = hours.reduce((a, b) => a + b, 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 3xl:gap-4">
      <Kpi i={0} icon={<BellRing />} tone={att.total ? TONE.danger : TONE.success} value={att.total} label="需要我" note={att.total ? `${att.waiting.length} 个任务等确认` : "没有待办的事"} hot={att.total > 0} onClick={onNeedMe} />
      <Kpi i={1} icon={<Activity />} tone={TONE.accent} value={running} label="任务在跑" note={`共 ${tasks.length} 个任务`} to={link("agent")} side={<Ring value={tasks.length ? running / tasks.length : 0} color={TONE.accent} />} />
      <Kpi i={2} icon={<MessageSquare />} tone={TONE.success} value={unread} label="条未读" note={`近 24 小时 ${today} 条消息`} to={link("chat")} side={today ? <Sparkline values={hours} color={TONE.success} height={44} /> : undefined} />
      <Kpi i={3} icon={<Server />} tone={TONE.warning} value={up} suffix={hosts.length ? `/ ${hosts.length}` : undefined} label="主机在线" note={hosts.length ? `${hosts.length - up} 台离线` : "还没有探针"} to={link("res")} side={<Ring value={hosts.length ? up / hosts.length : 0} color={TONE.warning} />} />
      <Kpi i={4} icon={<Bot />} tone={TONE.info} value={agents} label={CLOUD_AGENT_LABEL} note={`分布在 ${groups} 个群`} to={link("chat")} />
    </div>
  );
}

type KpiProps = { i: number; icon: ReactNode; tone: string; value: number; suffix?: string; label: string; note: string; hot?: boolean; side?: ReactNode; to?: string; onClick?: () => void };

function Kpi({ i, icon, tone, value, suffix, label, note, hot, side, to, onClick }: KpiProps) {
  const body = (
    <>
      {hot && <BorderBeam color={tone} duration={5} />}
      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="ov-icon grid size-7 place-items-center rounded-lg [&_svg]:size-[15px]">{icon}</span>
        {label}
      </span>
      <span className="mt-3 flex items-end justify-between gap-3">
        <span className="flex items-baseline gap-1.5">
          <NumberRoll value={value} mode="spring" format={INT} className="kpi-value num" />
          {suffix && <span className="num text-base text-muted-foreground">{suffix}</span>}
        </span>
        {side && <span className="relative z-[1] w-[40%] max-w-28 min-w-14 shrink-0">{side}</span>}
      </span>
      <span className="mt-2 truncate text-xs text-muted-foreground">{note}</span>
    </>
  );
  const cls = `kpi ${hot ? "is-hot" : ""} flex min-w-0 flex-col rounded-2xl p-4 text-left 3xl:p-5`;
  const style = { "--tone": tone } as CSSProperties;
  const motion = { initial: { opacity: 0, y: 14, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { delay: 0.05 + i * 0.06, type: "spring", stiffness: 260, damping: 24 } } as const;
  return to ? (
    <m.a href={to} className={cls} style={style} {...motion}>
      {body}
    </m.a>
  ) : (
    <m.button type="button" onClick={onClick} className={cls} style={style} {...motion}>
      {body}
    </m.button>
  );
}
