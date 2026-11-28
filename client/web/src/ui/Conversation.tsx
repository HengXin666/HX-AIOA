import { Button } from "@hx/ui/ui/button";
import { ArrowLeft, PanelRight } from "lucide-react";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useChats, usePresence, useUser, useVisible } from "../app/hooks";
import { go } from "../app/router";
import { chats, titleOf, type Message } from "../core/chats";
import { TXT_LOADING } from "../core/constants";
import { Composer } from "./Composer";
import type { ForwardMode } from "./chat/ForwardDialog";
import { SelectBar } from "./chat/SelectBar";
import { MessageItem, PendingItem, type MessageActions } from "./MessageItem";

const ForwardDialog = lazy(() => import("./chat/ForwardDialog"));
type Fwd = { items: Message[]; mode: ForwardMode };

const NEAR_BOTTOM_PX = 80;

// focus: 打开时要定位的消息 seq (收藏, 总览跳来)
export function Conversation({ channel, focus, narrow, pane, onPane }: { channel: string; focus?: number; narrow: boolean; pane: boolean; onPane: () => void }) {
  useChats();
  const meta = chats.meta(channel);
  const thread = chats.thread(channel);
  const pending = chats.outbox.of(channel);
  const me = useUser();
  const pres = usePresence(channel);
  const visible = useVisible();
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [reply, setReply] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [fwd, setFwd] = useState<Fwd | null>(null);

  useEffect(() => {
    void chats.loadThread(channel).catch((e: Error) => toast.error(e.message));
  }, [channel]);

  // 新消息到达时, 只有本来就在底部才跟着滚, 往上翻历史时不打扰
  const count = (thread?.items.length ?? 0) + pending.length;
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  // 看得见才算读过: 页面在前台时上报, 切回来再补
  const top = thread?.items[thread.items.length - 1]?.seq ?? 0;
  useEffect(() => {
    if (visible && meta) chats.markRead(channel);
  }, [channel, top, visible, meta]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (el.scrollTop === 0 && thread?.more && thread.synced) {
      const h = el.scrollHeight;
      void chats.loadThread(channel).then(() => requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - h)));
    }
  };

  // 定位: 消息已在本地就滚过去; 打开会话后第一页到了再试一次
  const loaded = Boolean(thread?.synced);
  useEffect(() => {
    if (!focus) return;
    stick.current = false;
    requestAnimationFrame(() => document.getElementById(`m-${focus}`)?.scrollIntoView({ block: "center" }));
  }, [focus, loaded]);

  const act = useMemo<MessageActions>(
    () => ({
      onReply: (m) => setReply(m),
      onForward: (m) => setFwd({ items: [m], mode: "each" }),
      onSelect: (m) =>
        setSelected((old) => {
          const next = new Set(old ?? []);
          if (next.has(m.seq)) next.delete(m.seq);
          else next.add(m.seq);
          return next;
        }),
    }),
    [],
  );
  const picked = (thread?.items ?? []).filter((m) => selected?.has(m.seq) && !m.deleted);
  const myId = me ? `user:${me.id}` : "";
  const typing = pres.typing.filter((t) => t.id !== myId);
  const owner = me?.role === "owner";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {narrow && (
          <Button size="icon-sm" variant="ghost" aria-label="返回" onClick={() => go({ name: "chats" })}>
            <ArrowLeft />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">{meta ? titleOf(meta) : channel}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {meta?.members ? `${meta.members} 人` : ""}
            {meta?.members && pres.listening.length ? " · " : ""}
            {pres.listening.length ? `${pres.listening.map((l) => l.name).join(", ")} 在听` : ""}
          </p>
        </div>
        <Button size="icon-sm" variant={pane ? "secondary" : "ghost"} aria-label="群资料" aria-pressed={pane} onClick={onPane}>
          <PanelRight />
        </Button>
      </header>
      <div ref={box} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!thread && <p className="text-center text-sm text-muted-foreground">{TXT_LOADING}</p>}
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {thread?.items.map((m) => (
            <MessageItem key={m.id} m={m} mine={Boolean(me && m.by === me.id)} owner={owner} act={act} selecting={selected !== null} selected={Boolean(selected?.has(m.seq))} />
          ))}
          {pending.map((p) => (
            <PendingItem key={p.cid} p={p} onRetry={() => chats.outbox.retry(p.cid)} onDiscard={() => chats.outbox.discard(p.cid)} />
          ))}
        </div>
      </div>
      <p className="h-5 px-4 text-xs text-muted-foreground" aria-live="polite">
        {typing.length ? `${typing.map((t) => t.name).join(", ")} 正在输入` : ""}
      </p>
      {selected ? (
        <SelectBar items={picked} owner={owner} onForward={(mode) => setFwd({ items: picked, mode })} onDone={() => setSelected(null)} />
      ) : (
        <Composer key={channel} channel={channel} meta={meta} reply={reply} onClearReply={() => setReply(null)} />
      )}
      {fwd && (
        <Suspense fallback={null}>
          <ForwardDialog
            items={fwd.items}
            mode={fwd.mode}
            from={meta ? titleOf(meta) : channel}
            onClose={(done) => {
              setFwd(null);
              if (done) setSelected(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
