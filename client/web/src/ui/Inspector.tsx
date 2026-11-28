import {
  MEMBERS_DEFAULT_LIMIT,
  PATH_CHAT_MEMBERS,
  PATH_CHAT_PRESENCE,
  QUERY_CURSOR,
  QUERY_LIMIT,
  type ChatMeta,
  type ChatPresence,
  type RoomMember,
  type RoomMembers,
} from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@hx/ui/ui/sheet";
import { Bot, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useChats, usePresence, useUser } from "../app/hooks";
import { api, fill } from "../core/auth";
import { chats, titleOf } from "../core/chats";
import { TXT_LOAD_MORE, TXT_LOADING } from "../core/constants";
import { GroupActions } from "./chat/GroupActions";
import { shortTime } from "./ChatList";
import { UserAvatar } from "./UserAvatar";

const ROLE_TEXT = { owner: "群主", admin: "管理员", member: "" } as const;

// 宽屏右侧一栏
export function InspectorPane({ channel, onClose }: { channel: string; onClose: () => void }) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-border">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold text-foreground">群资料</h2>
        <Button size="icon-sm" variant="ghost" aria-label="关闭" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Inspector channel={channel} />
      </div>
    </aside>
  );
}

// 中屏右抽屉 / 手机底部抽屉 (HX-UI sheet), Esc 与点遮罩关闭
export function InspectorSheet({ channel, open, side, onClose }: { channel: string; open: boolean; side: "right" | "bottom"; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side={side} className={side === "bottom" ? "max-h-[85vh]" : "w-[320px] sm:max-w-[320px]"}>
        <SheetHeader>
          <SheetTitle>群资料</SheetTitle>
          <SheetDescription className="sr-only">群公告, 成员与 Agent</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{open && <Inspector channel={channel} />}</div>
      </SheetContent>
    </Sheet>
  );
}

function Inspector({ channel }: { channel: string }) {
  useChats();
  const meta = chats.meta(channel);
  const pres = usePresence(channel);
  const me = useUser();
  if (!meta) return <p className="p-4 text-sm text-muted-foreground">{TXT_LOADING}</p>;
  const room = meta.members !== undefined || meta.kind === "dm";
  const listening = new Set(pres.listening.map((l) => l.id));
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <UserAvatar id={meta.avatar} name={titleOf(meta)} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{titleOf(meta)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {meta.kind === "dm" ? "单聊" : meta.members ? `${meta.members} 人` : "只有自己"}
            {meta.muted ? " · 免打扰" : ""}
          </p>
        </div>
      </div>
      {!(me?.role === "owner" || meta.role === "owner" || meta.role === "admin") && <Section title="群公告">
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{meta.notice || <span className="text-muted-foreground">暂无公告</span>}</p>
      </Section>}
      <Agents meta={meta} listening={listening} names={pres.listening.map((l) => l.name)} />
      {room && <Members key={channel} channel={channel} />}
      <GroupActions meta={meta} />
    </div>
  );
}

function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        {title}
        {extra}
      </h3>
      {children}
    </section>
  );
}

// 主人视图有完整的 Agent 资料; 子号只能从 presence 看到谁在听
function Agents({ meta, listening, names }: { meta: ChatMeta; listening: Set<string>; names: string[] }) {
  const list = meta.agents ?? [];
  if (!list.length && !names.length) return null;
  return (
    <Section title={`Agent (${list.length || names.length})`}>
      <ul className="flex flex-col gap-1">
        {list.map((a) => (
          <li key={a.keyId} className="flex items-center gap-2 text-sm">
            <Bot className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-foreground">{a.name}</span>
            {listening.has(a.keyId) ? (
              <Badge variant="outline" dot="success">
                在听
              </Badge>
            ) : a.pending ? (
              <Badge variant="outline" dot="warning">
                待报到
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">{a.active ? shortTime(a.active) : ""}</span>
            )}
          </li>
        ))}
        {!list.length &&
          names.map((n) => (
            <li key={n} className="flex items-center gap-2 text-sm">
              <Bot className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-foreground">{n}</span>
              <Badge variant="outline" dot="success">
                在听
              </Badge>
            </li>
          ))}
      </ul>
    </Section>
  );
}

// 成员分页; 在线状态打开时请求一次, 不轮询
function Members({ channel }: { channel: string }) {
  const [items, setItems] = useState<RoomMember[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [busy, setBusy] = useState(true);
  const [online, setOnline] = useState<ChatPresence | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (cursor?: string) => {
    setBusy(true);
    try {
      const q = `${QUERY_LIMIT}=${MEMBERS_DEFAULT_LIMIT}${cursor ? `&${QUERY_CURSOR}=${encodeURIComponent(cursor)}` : ""}`;
      const r = await api<RoomMembers>(`${fill(PATH_CHAT_MEMBERS, channel)}?${q}`);
      setItems((old) => (cursor ? [...old, ...(r?.members ?? [])] : (r?.members ?? [])));
      setNext(r?.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    void api<ChatPresence>(fill(PATH_CHAT_PRESENCE, channel))
      .then(setOnline)
      .catch(() => undefined);
    // 只在打开 (channel 变) 时取一次
  }, [channel]);

  const on = new Set(online?.online ?? []);
  return (
    <Section title={`成员${online ? ` · ${on.size} 在线` : ""}`}>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col gap-1">
        {items.map((m) => (
          <li key={m.id} className="flex items-center gap-2 rounded-md px-1 py-1">
            <UserAvatar id={m.avatar} name={m.display || m.name} size="sm" online={online ? on.has(m.id) : undefined} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{m.display || m.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {on.has(m.id) ? "在线" : online?.seen[m.id] ? `${shortTime(online.seen[m.id]!)} 在线过` : `@${m.name}`}
              </p>
            </div>
            {ROLE_TEXT[m.role] && <Badge variant="secondary">{ROLE_TEXT[m.role]}</Badge>}
          </li>
        ))}
      </ul>
      {busy && <p className="text-xs text-muted-foreground">{TXT_LOADING}</p>}
      {next && !busy && (
        <Button size="sm" variant="ghost" onClick={() => void load(next)}>
          {TXT_LOAD_MORE}
        </Button>
      )}
    </Section>
  );
}
