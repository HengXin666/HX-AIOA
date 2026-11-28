import { FEED_STATUS_LABEL, feedTagsOf, type FeedTag } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Ban, Check, Heart, MessageCircle, Star, ThumbsUp } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useChats } from "../../../app/hooks";
import { nav } from "../../../app/router";
import { chats, titleOf } from "../../../core/chats";
import { EXTERNAL, LOCALE, TXT_LOAD_MORE, TXT_LOADING } from "../../../core/constants";
import { feedEntries, feedMarks, labelOf, MARK_DEAD, MARK_STAR, MARK_USED, TAG_OTHER, type FeedEntry } from "../../../core/feed-items";
import { shortTime } from "../../ChatList";
import { PageHeader } from "../../kit/Panes";

const TABS = ["今天", "全部", "收藏", "用过"] as const;
type Tab = (typeof TABS)[number];
const LIVE = new Set(["ok", "go"]);
const MAX_STATS = 4;
const STATUS_DOT = { ok: "success", go: "info", doubt: "warning", dead: "muted" } as const;

const startOfDay = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();
const useMarks = () => useSyncExternalStore((fn) => feedMarks.changed.on(fn), () => feedMarks.version);

// 信息流群 (对照安卓 feed/FeedView.kt): 群里所有推送按条目平铺; 今天 / 全部 / 收藏 / 用过, 类别筛选, 只看有效
export default function FeedView({ channel, narrow, onPane }: { channel: string; narrow: boolean; onPane?: () => void }) {
  useChats();
  useMarks();
  const meta = chats.meta(channel);
  const thread = chats.thread(channel);
  const tags = feedTagsOf(meta).tags;
  const [tab, setTab] = useState<Tab>("今天");
  const [kind, setKind] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    void chats.loadThread(channel).catch((e: Error) => toast.error(e.message));
  }, [channel]);
  const top = thread?.items[thread.items.length - 1]?.seq ?? 0;
  useEffect(() => {
    if (meta) chats.markRead(channel);
  }, [channel, top, meta]);

  const all = useMemo(() => feedEntries(thread?.items ?? []), [thread?.items]);
  const today = startOfDay();
  const inTab = all.filter((e) => (tab === "今天" ? e.ts >= today : tab === "收藏" ? feedMarks.has(MARK_STAR, e.key) : tab === "用过" ? feedMarks.has(MARK_USED, e.key) : true));
  const kinds = [...tags.map((t) => t.id), ...[...new Set(all.map((e) => e.kind))].filter((k) => !tags.some((t) => t.id === k))];
  const shown = inTab.filter((e) => (kind === null || e.kind === kind) && (!live || LIVE.has(feedMarks.status(e) ?? "")));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={meta ? titleOf(meta) : channel} sub="信息流" back={narrow ? () => nav("chat") : undefined} actions={onPane && <Button size="sm" variant="ghost" onClick={onPane}>群资料</Button>} />
      <div className="flex gap-4 px-4 pt-2">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`border-b-2 pb-1 text-sm ${tab === t ? "border-brand font-semibold text-foreground" : "border-transparent text-muted-foreground"}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto px-3 py-2">
        <Button size="xs" variant={kind === null ? "secondary" : "ghost"} onClick={() => setKind(null)}>
          全部 {inTab.length}
        </Button>
        {kinds.map((k) => {
          const n = inTab.filter((e) => e.kind === k).length;
          return n > 0 ? (
            <Button key={k} size="xs" variant={kind === k ? "secondary" : "ghost"} onClick={() => setKind(kind === k ? null : k)}>
              {labelOf(tags, k)} {n}
            </Button>
          ) : null;
        })}
        {all.some((e) => e.status) && (
          <Button size="xs" variant={live ? "secondary" : "ghost"} onClick={() => setLive(!live)}>
            <Check />
            只看有效
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <div className="mx-auto grid max-w-5xl gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
          {tab === "今天" && inTab.length > 0 && <Today items={inTab} kinds={kinds} tags={tags} />}
          {!thread && <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>}
          {thread && shown.length === 0 && <p className="col-span-full p-10 text-center text-sm text-muted-foreground">{tab === "收藏" ? "还没有收藏, 点条目右上角的星标收藏" : "这里还没有内容"}</p>}
          {shown.map((e) => (
            <Card key={e.key} e={e} tags={tags} />
          ))}
        </div>
        {thread?.more && thread.synced && (
          <div className="p-3 text-center">
            <Button size="sm" variant="ghost" onClick={() => void chats.loadThread(channel)}>
              {TXT_LOAD_MORE}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Today({ items, kinds, tags }: { items: FeedEntry[]; kinds: string[]; tags: FeedTag[] }) {
  const stats = kinds.map((k) => [k, items.filter((e) => e.kind === k).length] as const).filter(([, n]) => n > 0).slice(0, MAX_STATS);
  const rated = items.filter((e) => e.status);
  const ok = rated.filter((e) => LIVE.has(feedMarks.status(e) ?? "")).length;
  return (
    <section className="col-span-full rounded-xl border border-border bg-card p-3">
      <h3 className="flex text-sm font-semibold text-foreground">
        <span className="flex-1">今天 · {new Date().toLocaleDateString(LOCALE, { month: "numeric", day: "numeric" })}</span>
        <span className="text-xs font-normal text-muted-foreground">截至 {new Date().toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}</span>
      </h3>
      {stats.every(([k]) => k === TAG_OTHER) ? (
        <p className="mt-2 text-xs text-muted-foreground">今天 {items.length} 条都是普通消息, 推送方切到信息流格式后会按类别统计</p>
      ) : (
        <div className="mt-3 flex">
          {stats.map(([k, n]) => (
            <Stat key={k} label={labelOf(tags, k)} n={n} />
          ))}
          {rated.length > 0 && <Stat label="仍有效" n={ok} />}
        </div>
      )}
    </section>
  );
}

function Stat({ label, n }: { label: string; n: number }) {
  return (
    <div className="flex flex-1 flex-col items-center">
      <span className="text-2xl font-bold text-foreground">{n}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function Card({ e, tags }: { e: FeedEntry; tags: FeedTag[] }) {
  const status = feedMarks.status(e);
  const used = feedMarks.has(MARK_USED, e.key);
  const star = feedMarks.has(MARK_STAR, e.key);
  const mine = feedMarks.has(MARK_DEAD, e.key);
  const title = e.url ? (
    <a href={e.url} {...EXTERNAL} className="hover:underline">
      {e.title}
    </a>
  ) : (
    e.title
  );
  return (
    <article className={`flex flex-col gap-2 rounded-xl border border-border bg-card p-3 ${used || status === "dead" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 text-sm font-semibold break-words text-foreground">{title}</h4>
        <Button size="icon-xs" variant="ghost" aria-label={star ? "取消收藏" : "收藏"} aria-pressed={star} onClick={() => feedMarks.toggle(MARK_STAR, e.key)}>
          <Star className={star ? "fill-current text-warning" : ""} />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="secondary">{labelOf(tags, e.kind)}</Badge>
        {status && (
          <Badge variant="outline" dot={STATUS_DOT[status]}>
            {FEED_STATUS_LABEL[status]}
          </Badge>
        )}
        {e.until && <Badge variant="outline">截止 {e.until}</Badge>}
      </div>
      {e.summary && <p className="line-clamp-4 text-sm break-words whitespace-pre-wrap text-muted-foreground">{e.summary}</p>}
      {e.todo && <p className="text-xs text-foreground">要做: {e.todo}</p>}
      <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground [&_svg]:size-3.5">
        <span>
          {e.site || e.source} · {shortTime(e.time)}
        </span>
        {e.heat !== undefined && (
          <span className="flex items-center gap-0.5">
            <Heart />
            {e.heat}
          </span>
        )}
        {e.likes !== undefined && (
          <span className="flex items-center gap-0.5">
            <ThumbsUp />
            {e.likes}
          </span>
        )}
        {e.replies !== undefined && (
          <span className="flex items-center gap-0.5">
            <MessageCircle />
            {e.replies}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          {e.links.slice(0, 1).map((l) => (
            <a key={l.url} href={l.url} {...EXTERNAL} className="text-brand hover:underline">
              {l.label}
              {e.links.length > 1 ? ` +${e.links.length - 1}` : ""}
            </a>
          ))}
        </span>
      </div>
      <div className="flex gap-1">
        <Button size="xs" variant={used ? "secondary" : "ghost"} onClick={() => feedMarks.toggle(MARK_USED, e.key)}>
          <Check />
          {used ? "已用过" : "用过了"}
        </Button>
        <Button size="xs" variant={mine ? "secondary" : "ghost"} onClick={() => feedMarks.toggle(MARK_DEAD, e.key)}>
          <Ban />
          {mine ? "已标失效" : "标失效"}
        </Button>
      </div>
    </article>
  );
}
