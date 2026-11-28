import type { ChatMeta } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@hx/ui/ui/dropdown-menu";
import { Input } from "@hx/ui/ui/input";
import { Bell, BellOff, Ellipsis, Pin, PinOff, Search, Star } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { useChats, useLinkState, useUser } from "../app/hooks";
import { href } from "../app/router";
import { chats, textOf, titleOf, type Message } from "../core/chats";
import { TXT_EMPTY_CHATS, TXT_LOADING, LOCALE } from "../core/constants";
import { UserAvatar } from "./UserAvatar";

const Favorites = lazy(() => import("./chat/Favorites"));

const STATE_TEXT = { idle: "", connecting: "连接中", online: "", offline: "重连中" } as const;
const MAX_BADGE = 99;
// 触屏没有悬停: 行尾按钮常显
const HOVER_REVEAL = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100";

export function ChatList({ active }: { active: string | null }) {
  const { last, version } = useChats();
  const state = useLinkState();
  const [q, setQ] = useState("");
  const [fav, setFav] = useState(false);
  const owner = useUser()?.role === "owner";
  // version 变化即重算 (置顶, 已读, 新消息都会改它)
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    const all = chats.ordered();
    if (!k) return all;
    return all.filter((c) => titleOf(c).toLowerCase().includes(k) || (last[c.channel] ? textOf(last[c.channel]!).toLowerCase().includes(k) : false));
  }, [last, version, q]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 p-3">
        <h2 className="text-base font-semibold text-foreground">消息</h2>
        <span className="flex-1 text-xs text-muted-foreground">{STATE_TEXT[state]}</span>
        {owner && (
          <Button size="icon-sm" variant="ghost" aria-label="收藏" title="收藏" onClick={() => setFav(true)}>
            <Star />
          </Button>
        )}
      </header>
      {fav && (
        <Suspense fallback={null}>
          <Favorites side="right" onClose={() => setFav(false)} />
        </Suspense>
      )}
      <div className="px-3 pb-2">
        <Input size="sm" leading={<Search />} placeholder="搜索会话" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {rows.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{q ? "没有匹配的会话" : state === "online" ? TXT_EMPTY_CHATS : TXT_LOADING}</li>}
        {rows.map((c) => (
          <Row key={c.channel} chat={c} last={last[c.channel]} active={c.channel === active} unread={chats.unread(c)} />
        ))}
      </ul>
    </div>
  );
}

const toggle = (c: ChatMeta, p: { pinned?: boolean; muted?: boolean }) =>
  void chats.patch(c.channel, p).catch((e: Error) => toast.error(e.message));

function Row({ chat, last, active, unread }: { chat: ChatMeta; last?: Message; active: boolean; unread: number }) {
  const title = titleOf(chat);
  return (
    <li className="group relative">
      <a href={href({ name: "chat", channel: chat.channel })} className={`flex items-center gap-3 rounded-lg px-2 py-2 pr-9 ${active ? "bg-accent" : "hover:bg-muted"}`}>
        <UserAvatar id={chat.avatar} name={title} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-sm font-medium text-foreground">{title}</span>
            {chat.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="已置顶" />}
            {chat.muted && <BellOff className="size-3 shrink-0 text-muted-foreground" aria-label="免打扰" />}
            {last && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{shortTime(last.ts)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{last ? textOf(last).split("\n")[0] : " "}</p>
            <Badge n={unread} muted={Boolean(chat.muted)} />
          </div>
        </div>
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label="会话操作" className={`absolute top-1/2 right-2 -translate-y-1/2 ${HOVER_REVEAL}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => toggle(chat, { pinned: !chat.pinned })}>
            {chat.pinned ? <PinOff /> : <Pin />}
            {chat.pinned ? "取消置顶" : "置顶"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggle(chat, { muted: !chat.muted })}>
            {chat.muted ? <Bell /> : <BellOff />}
            {chat.muted ? "取消免打扰" : "免打扰"}
          </DropdownMenuItem>
          {unread !== 0 && <DropdownMenuItem onSelect={() => chats.markRead(chat.channel)}>标为已读</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

// 免打扰的群只给灰色; 数不出条数时给一个点
function Badge({ n, muted }: { n: number; muted: boolean }) {
  if (n === 0) return null;
  const tone = muted ? "bg-muted-foreground/40 text-background" : "bg-brand text-brand-foreground";
  if (n < 0 || muted) return <span className={`size-2 shrink-0 rounded-full ${tone}`} aria-label="有未读" />;
  return <span className={`min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] leading-5 font-medium ${tone}`}>{n > MAX_BADGE ? `${MAX_BADGE}+` : n}</span>;
}

export function shortTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(LOCALE, { month: "numeric", day: "numeric" });
}
