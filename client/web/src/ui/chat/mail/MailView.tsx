import type { MailFacet, MailInfo } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Input } from "@hx/ui/ui/input";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Layout } from "../../../app/hooks";
import { nav } from "../../../app/router";
import { chats, type Message } from "../../../core/chats";
import { TXT_LOAD_MORE, TXT_LOADING } from "../../../core/constants";
import { link } from "../../../core/link";
import { mailFacets, mailList } from "../../../core/mail";
import { shortTime } from "../../ChatList";
import { EmptyState, PageHeader } from "../../kit/Panes";
import { UserAvatar } from "../../UserAvatar";
import { MailDetail } from "./MailDetail";

const SEARCH_DELAY_MS = 300;
const ALL = "";

// 邮件群 (对照安卓 ch-mail): 全部 | 按厂商, 搜索主题与发件人; 电脑左列表右详情, 手机点进详情
export default function MailView({ channel, layout }: { channel: string; layout: Layout }) {
  const [facets, setFacets] = useState<MailFacet[]>([]);
  const [vendor, setVendor] = useState(ALL);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Message[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<Message | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [q]);

  const load = async (before?: number) => {
    const g = ++gen.current;
    try {
      const r = await mailList({ vendor: vendor || undefined, q: query || undefined, before });
      if (g !== gen.current) return;
      const got = r.messages.filter((m): m is Message => m.kind !== "metric");
      setItems((old) => (before ? [...(old ?? []), ...got] : got));
      setMore(r.more);
      setError(null);
    } catch (e) {
      if (g === gen.current) setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    setItems(null);
    void load();
  }, [vendor, query]);

  // 新信进群: 只在看 "全部" 且没搜索时插到最前, 筛选中不打扰
  useEffect(() => {
    void mailFacets()
      .then((f) => setFacets(f.vendors))
      .catch(() => undefined);
    return link.frames.on((f) => {
      const ev = f.t === "ev" ? (f.ev as Message) : null;
      if (!ev || ev.channel !== channel || ev.kind !== "event" || !ev.data.mail || vendor || query) return;
      setItems((old) => (old ? [ev, ...old.filter((m) => m.id !== ev.id)] : old));
    });
  }, [channel, vendor, query]);

  useEffect(() => {
    if (items?.length) chats.markRead(channel);
  }, [items, channel]);

  const narrow = layout === "narrow";
  if (narrow && open) return <MailDetail m={open} back={() => setOpen(null)} />;

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="邮件" back={narrow ? () => nav("chat") : undefined} />
      <div className="flex flex-col gap-2 p-3 pb-1">
        <Input size="sm" leading={<Search />} placeholder="搜主题或发件人" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-1 overflow-x-auto pb-1">
          <Chip on={vendor === ALL} onClick={() => setVendor(ALL)}>
            全部
          </Chip>
          {facets.map((f) => (
            <Chip key={f.key} on={vendor === f.key} onClick={() => setVendor(f.key)}>
              {f.key || "未知"} {f.count}
            </Chip>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {error && <li className="p-3 text-sm text-destructive">{error}</li>}
        {!items && !error && <li className="p-6 text-center text-sm text-muted-foreground">{TXT_LOADING}</li>}
        {items?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">没有邮件</li>}
        {items?.map((m) => (
          <Row key={m.id} m={m} active={open?.id === m.id} onOpen={() => setOpen(m)} />
        ))}
        {more && (
          <li className="p-2 text-center">
            <Button size="sm" variant="ghost" onClick={() => void load(items?.[items.length - 1]?.ts)}>
              {TXT_LOAD_MORE}
            </Button>
          </li>
        )}
      </ul>
    </div>
  );
  if (narrow) return list;
  return (
    <div className="flex h-full min-h-0 w-full">
      <section className="flex w-[380px] shrink-0 flex-col border-r border-border">{list}</section>
      <div className="flex min-w-0 flex-1 flex-col">{open ? <MailDetail key={open.id} m={open} /> : <EmptyState>选一封邮件</EmptyState>}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="xs" variant={on ? "secondary" : "ghost"} className="shrink-0" onClick={onClick}>
      {children}
    </Button>
  );
}

function Row({ m, active, onOpen }: { m: Message; active: boolean; onOpen: () => void }) {
  const d = m.kind === "event" ? m.data : null;
  const mail = d?.mail as MailInfo | undefined;
  const code = mail?.otp?.code ?? mail?.code;
  return (
    <li>
      <button type="button" onClick={onOpen} className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left ${active ? "bg-accent" : "hover:bg-muted"}`}>
        <UserAvatar name={mail?.vendor || mail?.from || "?"} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{mail?.name || mail?.vendor || mail?.from}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{shortTime(m.ts)}</span>
          </span>
          <span className="block truncate text-sm text-foreground">{d?.title || "(无主题)"}</span>
          <span className="flex items-center gap-2">
            {code && <Badge variant="outline">{code}</Badge>}
            {mail?.kind !== "marketing" && (mail?.brief || d?.summary) && <span className="min-w-0 truncate text-xs text-muted-foreground">{mail?.brief || d?.summary}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
