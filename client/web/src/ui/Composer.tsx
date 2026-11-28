import { TYPING_THROTTLE_MS, type ChatMeta } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { Textarea } from "@hx/ui/ui/textarea";
import { SendHorizontal, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { filterCandidates, MentionList, queryAt, useCandidates, type Candidate } from "./chat/Mentions";
import { chats, textOf, type Message } from "../core/chats";
import { MEMO_GROUP } from "../core/constants";
import { link } from "../core/link";

const DRAFT = "aioa.draft.";

type Props = { channel: string; meta: ChatMeta | undefined; reply: Message | null; onClearReply: () => void };

// 输入框: 草稿存本地 (刷新, 版本更新不丢); 输入时最多每 4 秒报一次 "正在输入"
export function Composer({ channel, meta, reply, onClearReply }: Props) {
  const [text, setText] = useState(() => localStorage.getItem(DRAFT + channel) ?? "");
  const lastTyping = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);
  // @ 选择: 光标前有 "@词" 时弹出; picked 记 "@名字" 对应的 id, 发送时只带还留在文字里的
  const [at, setAt] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const picked = useRef(new Map<string, string>());
  const candidates = filterCandidates(useCandidates(channel, meta, at !== null), at ?? "");
  const showAt = at !== null && candidates.length > 0;

  const caret = (v: string) => {
    const el = box.current;
    const q = el ? queryAt(v.slice(0, el.selectionStart ?? v.length)) : null;
    setAt(q);
    setIndex(0);
  };

  const pick = (c: Candidate) => {
    const el = box.current;
    if (!el) return;
    const end = el.selectionStart ?? text.length;
    const start = text.slice(0, end).lastIndexOf("@");
    const tag = `@${c.name} `;
    const next = text.slice(0, start) + tag + text.slice(end);
    picked.current.set(`@${c.name}`, c.id);
    change(next);
    setAt(null);
    requestAnimationFrame(() => el.setSelectionRange(start + tag.length, start + tag.length));
  };

  const change = (v: string) => {
    setText(v);
    if (v) localStorage.setItem(DRAFT + channel, v);
    else localStorage.removeItem(DRAFT + channel);
    const now = Date.now();
    if (v && channel !== MEMO_GROUP && now - lastTyping.current >= TYPING_THROTTLE_MS) {
      lastTyping.current = now;
      link.write({ t: "typing", channel });
    }
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    const mentions = [...picked.current].filter(([tag]) => t.includes(tag)).map(([, id]) => id);
    chats.send(channel, t, { reply: reply ?? undefined, mentions });
    picked.current.clear();
    lastTyping.current = 0;
    change("");
    onClearReply();
    box.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showAt && !e.nativeEvent.isComposing) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        return setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length);
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return pick(candidates[index] ?? candidates[0]!);
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        return setAt(null);
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
    if (e.key === "Escape" && reply) {
      e.stopPropagation();
      onClearReply();
    }
  };

  return (
    <div className="safe-bottom border-t border-border p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {reply && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              引用 {reply.source.name}: {textOf(reply).split("\n")[0]}
            </span>
            <Button size="icon-xs" variant="ghost" aria-label="取消引用" onClick={onClearReply}>
              <X />
            </Button>
          </div>
        )}
        <div className="relative flex items-end gap-2">
          {showAt && <MentionList items={candidates} index={index} onPick={pick} />}
          <Textarea
            ref={box}
            rows={1}
            className="max-h-40 min-h-10 resize-none"
            placeholder="发消息 (Enter 发送, Shift+Enter 换行)"
            value={text}
            onChange={(e) => {
              change(e.target.value);
              caret(e.target.value);
            }}
            onBlur={() => setAt(null)}
            onKeyDown={onKey}
          />
          <Button size="icon" aria-label="发送" disabled={!text.trim()} onClick={send}>
            <SendHorizontal />
          </Button>
        </div>
      </div>
    </div>
  );
}
