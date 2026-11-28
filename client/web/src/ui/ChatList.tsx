import type { ChatMeta } from "@hx-aioa/protocol";
import { Input } from "@hx/ui/ui/input";
import { BellOff, Pin, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useChats, useLinkState } from "../app/hooks";
import { href } from "../app/router";
import { textOf, type Message } from "../core/chats";
import { TXT_EMPTY_CHATS, TXT_LOADING } from "../core/constants";
import { UserAvatar } from "./UserAvatar";

const STATE_TEXT = { idle: "", connecting: "连接中", online: "", offline: "重连中" } as const;

// 置顶在前, 其余按最后一条消息 (没有就按群资料更新时间) 倒序
function order(chats: ChatMeta[], last: Record<string, Message | undefined>): ChatMeta[] {
  const at = (c: ChatMeta) => last[c.channel]?.ts ?? c.updated;
  return [...chats].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || at(b) - at(a));
}

export function ChatList({ active }: { active: string | null }) {
  const { chats, last, version } = useChats();
  const state = useLinkState();
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    const all = order(chats, last);
    return k ? all.filter((c) => (c.title ?? c.channel).toLowerCase().includes(k)) : all;
  }, [chats, last, version, q]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 p-3">
        <h2 className="text-base font-semibold text-foreground">消息</h2>
        <span className="text-xs text-muted-foreground">{STATE_TEXT[state]}</span>
      </header>
      <div className="px-3 pb-2">
        <Input size="sm" leading={<Search />} placeholder="搜索会话" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {rows.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{state === "online" ? TXT_EMPTY_CHATS : TXT_LOADING}</li>}
        {rows.map((c) => (
          <Row key={c.channel} chat={c} last={last[c.channel]} active={c.channel === active} />
        ))}
      </ul>
    </div>
  );
}

function Row({ chat, last, active }: { chat: ChatMeta; last?: Message; active: boolean }) {
  const title = chat.title || chat.channel;
  const unread = last && (chat.read ?? 0) < last.seq && !chat.muted;
  return (
    <li>
      <a
        href={href({ name: "chat", channel: chat.channel })}
        className={`flex items-center gap-3 rounded-lg px-2 py-2 ${active ? "bg-accent" : "hover:bg-muted"}`}
      >
        <UserAvatar id={chat.avatar} name={title} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-sm font-medium text-foreground">{title}</span>
            {chat.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
            {chat.muted && <BellOff className="size-3 shrink-0 text-muted-foreground" />}
            {last && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{shortTime(last.ts)}</span>}
          </div>
          <p className="truncate text-xs text-muted-foreground">{last ? textOf(last).split("\n")[0] : " "}</p>
        </div>
        {unread && <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="未读" />}
      </a>
    </li>
  );
}

export function shortTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
