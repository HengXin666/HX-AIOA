import { Button } from "@hx/ui/ui/button";
import { Textarea } from "@hx/ui/ui/textarea";
import { ArrowLeft, SendHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { useChats, useLinkState, useUser } from "../app/hooks";
import { go } from "../app/router";
import { chats } from "../core/chats";
import { MEMO_GROUP, TXT_LOADING } from "../core/constants";
import { link } from "../core/link";
import { MessageItem } from "./MessageItem";

const NEAR_BOTTOM_PX = 80;

export function Conversation({ channel, narrow }: { channel: string; narrow: boolean }) {
  useChats();
  const meta = chats.snapshot().chats.find((c) => c.channel === channel);
  const thread = chats.thread(channel);
  const me = useUser();
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    void chats.loadThread(channel).catch((e: Error) => toast.error(e.message));
  }, [channel]);

  // 新消息到达时, 只有本来就在底部才跟着滚, 往上翻历史时不打扰
  const count = thread?.items.length ?? 0;
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (el.scrollTop === 0 && thread?.more) {
      const h = el.scrollHeight;
      void chats.loadThread(channel).then(() => requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - h)));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {narrow && (
          <Button size="icon-sm" variant="ghost" aria-label="返回" onClick={() => go({ name: "chats" })}>
            <ArrowLeft />
          </Button>
        )}
        <h2 className="truncate text-base font-semibold text-foreground">{meta?.title || channel}</h2>
        {meta?.members ? <span className="text-xs text-muted-foreground">{meta.members} 人</span> : null}
      </header>
      <div ref={box} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!thread && <p className="text-center text-sm text-muted-foreground">{TXT_LOADING}</p>}
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {thread?.items.map((m) => <MessageItem key={m.id} m={m} mine={Boolean(me && m.by === me.id)} />)}
        </div>
      </div>
      <Composer channel={channel} />
    </div>
  );
}

function Composer({ channel }: { channel: string }) {
  const [text, setText] = useState("");
  const state = useLinkState();
  const send = () => {
    const t = text.trim();
    if (!t) return;
    const ok = link.send({ body: { kind: "text", text: t }, channel: channel === MEMO_GROUP ? undefined : channel });
    if (!ok) return void toast.error("还没连上, 稍后再发");
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  return (
    <div className="safe-bottom border-t border-border p-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea rows={1} className="max-h-40 min-h-10 resize-none" placeholder="发消息 (Enter 发送, Shift+Enter 换行)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        <Button size="icon" aria-label="发送" disabled={!text.trim() || state !== "online"} onClick={send}>
          <SendHorizontal />
        </Button>
      </div>
    </div>
  );
}
