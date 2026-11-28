import { Bot, LayoutDashboard, MessageSquare, Server, UserRound } from "lucide-react";
import { m } from "motion/react";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useAttention, useChats } from "../../app/hooks";
import { nav, type AreaId } from "../../app/router";
import { chats } from "../../core/chats";

export type NavItem = { area: AreaId; label: string; hint: string; icon: ReactNode; tone: string; key: string };

// 每栏一个固定色, 侧栏图标块, 底栏, 页内标题都用它, 一眼认出在哪
export const NAV: NavItem[] = [
  { area: "overview", label: "总览", hint: "今天的一切", icon: <LayoutDashboard />, tone: "var(--info)", key: "1" },
  { area: "chat", label: "消息", hint: "群聊与私聊", icon: <MessageSquare />, tone: "var(--success)", key: "2" },
  { area: "agent", label: "Agent", hint: "任务与会话", icon: <Bot />, tone: "var(--chart-2)", key: "3" },
  { area: "res", label: "资源", hint: "主机与服务", icon: <Server />, tone: "var(--warning)", key: "4" },
  { area: "me", label: "我的", hint: "账号与设置", icon: <UserRound />, tone: "var(--muted-foreground)", key: "5" },
];

// -1 表示有新内容但数不出条数, 只画圆点
export type Counts = Partial<Record<AreaId, { n: number; tone: "danger" | "plain" }>>;

export function useNavCounts(): Counts {
  const att = useAttention();
  useChats();
  let unread = 0;
  let dot = false;
  for (const c of chats.ordered()) {
    if (c.muted) continue;
    const n = chats.unread(c);
    if (n < 0) dot = true;
    else unread += n;
  }
  const counts: Counts = {};
  if (att.items.length) counts.overview = { n: att.items.length, tone: "danger" };
  if (unread || dot) counts.chat = { n: unread || -1, tone: "plain" };
  if (att.waiting.length) counts.agent = { n: att.waiting.length, tone: "danger" };
  return counts;
}

// Alt+1..5 切栏
export function useNavKeys(): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const hit = NAV.find((n) => n.key === e.key);
      if (!hit) return;
      e.preventDefault();
      nav(hit.area);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

const MAX_SHOWN = 99;

export function CountBadge({ c, compact }: { c?: Counts[AreaId]; compact?: boolean }) {
  if (!c) return null;
  const danger = c.tone === "danger";
  if (c.n < 0 || compact) {
    return <span aria-hidden className={`block size-2 rounded-full ring-2 ring-sidebar ${danger ? "bg-destructive shadow-[0_0_8px_var(--destructive)]" : "bg-foreground"}`} />;
  }
  // 数字变了重新弹一下 (key 换了就重播)
  return (
    <m.span
      key={c.n}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 520, damping: 22 }}
      className={`num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold ${danger ? "bg-destructive text-white shadow-[0_0_12px_-2px_var(--destructive)]" : "bg-foreground/90 text-background"}`}
    >
      {c.n > MAX_SHOWN ? `${MAX_SHOWN}+` : c.n}
    </m.span>
  );
}

// 图标块: 选中时实色渐变底 + 白图标, 平时是淡底 + 有色图标; 悬停时淡底加深
export function IconTile({ tone, active, size = "md", children }: { tone: string; active?: boolean; size?: "sm" | "md" | "lg"; children: ReactNode }) {
  const box = size === "sm" ? "size-6 rounded-[7px] [&_svg]:size-3.5" : size === "lg" ? "size-9 rounded-[11px] [&_svg]:size-[18px]" : "size-7 rounded-[9px] [&_svg]:size-4";
  return (
    <span className={`nav-tile ${box} ${active ? "is-on" : ""}`} style={{ "--tile": tone } as CSSProperties}>
      {children}
    </span>
  );
}
