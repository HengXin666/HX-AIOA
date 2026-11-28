import { MENTION_AGENT_PREFIX, MENTION_ALL, MEMBERS_DEFAULT_LIMIT, PATH_CHAT_MEMBERS, QUERY_LIMIT, type ChatMeta, type RoomMembers } from "@hx-aioa/protocol";
import { Bot, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api, currentUser, fill } from "../../core/auth";
import { UserAvatar } from "../UserAvatar";

export type Candidate = { id: string; name: string; kind: "all" | "agent" | "user"; avatar?: string };
// 输入框里光标前的 "@词": 只在行首或空白后才算
const AT_RE = /(?:^|\s)@([^\s@]*)$/;
const MAX_SHOWN = 8;

export const queryAt = (before: string): string | null => AT_RE.exec(before)?.[1] ?? null;

// @ 候选 (对照安卓 ch-mention, #131): 全体, 群 Agent, 真人; 成员只在第一次弹出时取一页
export function useCandidates(channel: string, meta: ChatMeta | undefined, active: boolean): Candidate[] {
  const [users, setUsers] = useState<Candidate[] | null>(null);
  const room = Boolean(meta?.members);
  useEffect(() => {
    if (!active || users || !room) return;
    const me = currentUser()?.id;
    void api<RoomMembers>(`${fill(PATH_CHAT_MEMBERS, channel)}?${QUERY_LIMIT}=${MEMBERS_DEFAULT_LIMIT}`)
      .then((r) => setUsers((r?.members ?? []).filter((m) => m.id !== me).map((m) => ({ id: m.id, name: m.display || m.name, kind: "user", avatar: m.avatar }))))
      .catch(() => setUsers([]));
  }, [active, users, room, channel]);
  const agents: Candidate[] = (meta?.agents ?? []).map((a) => ({ id: MENTION_AGENT_PREFIX + a.keyId, name: a.name, kind: "agent" }));
  const all: Candidate[] = room || agents.length ? [{ id: MENTION_ALL, name: "全体", kind: "all" }] : [];
  return [...all, ...agents, ...(users ?? [])];
}

export const filterCandidates = (list: Candidate[], q: string): Candidate[] => {
  const k = q.toLowerCase();
  return list.filter((c) => c.name.toLowerCase().includes(k)).slice(0, MAX_SHOWN);
};

export function MentionList({ items, index, onPick }: { items: Candidate[]; index: number; onPick: (c: Candidate) => void }) {
  if (!items.length) return null;
  return (
    <ul role="listbox" aria-label="@ 选择" className="absolute bottom-full left-0 z-20 mb-2 w-64 max-w-full overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
      {items.map((c, i) => (
        <li key={c.id} role="option" aria-selected={i === index}>
          <button
            type="button"
            // 不抢输入框焦点
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm [&_svg]:size-4 ${i === index ? "bg-accent" : "hover:bg-muted"}`}
          >
            {c.kind === "user" ? <UserAvatar id={c.avatar} name={c.name} size="sm" /> : c.kind === "agent" ? <Bot /> : <Users />}
            <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
            <span className="text-xs text-muted-foreground">{c.kind === "agent" ? "Agent" : c.kind === "all" ? "所有人" : ""}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
