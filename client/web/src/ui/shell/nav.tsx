import { Bot, LayoutDashboard, MessageSquare, Server, UserRound, type LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { useAttention, useChats } from "../../app/hooks";
import { nav, type AreaId } from "../../app/router";
import { chats } from "../../core/chats";

export type NavItem = { area: AreaId; label: string; icon: LucideIcon; key: string };

// 主导航; 图标一律单色, 颜色只留给状态 (需要我的红点)
export const NAV: NavItem[] = [
  { area: "overview", label: "总览", icon: LayoutDashboard, key: "1" },
  { area: "chat", label: "消息", icon: MessageSquare, key: "2" },
  { area: "agent", label: "Agent", icon: Bot, key: "3" },
  { area: "res", label: "资源", icon: Server, key: "4" },
  { area: "me", label: "我的", icon: UserRound, key: "5" },
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

export function CountBadge({ c }: { c?: Counts[AreaId] }) {
  if (!c) return null;
  const danger = c.tone === "danger";
  if (c.n < 0) return <span aria-label="有新消息" className="size-1.5 rounded-full bg-foreground/70" />;
  return <span className={`tabular-nums ${danger ? "text-destructive" : ""}`}>{c.n > MAX_SHOWN ? `${MAX_SHOWN}+` : c.n}</span>;
}
