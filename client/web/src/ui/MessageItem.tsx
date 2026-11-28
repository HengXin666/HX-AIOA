import { PATH_EVENT_BY_SEQ, QUERY_MODE } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@hx/ui/ui/dropdown-menu";
import { Checkbox } from "@hx/ui/ui/checkbox";
import { CheckSquare, Copy, HardDrive, CornerUpLeft, Ellipsis, Forward, RotateCcw, Star, Trash2, Undo2 } from "lucide-react";
import { memo, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { api, fill } from "../core/auth";
import { mentionsMe, textOf, type Message } from "../core/chats";
import { saveFile } from "../core/drive";
import { favorite } from "../core/msg-actions";
import { EXTERNAL } from "../core/constants";
import type { Pending } from "../core/outbox";
import { shortTime } from "./ChatList";
import { UserAvatar } from "./UserAvatar";
import { BundleCard, FileView, HtmlCard, richText } from "./MessageParts";

export type MessageActions = {
  onReply: (m: Message) => void;
  onForward: (m: Message) => void;
  // 进入多选并选中这一条; 多选中点消息切换选中
  onSelect: (m: Message) => void;
};
// head: 同一发送者连续几条里的第一条, 才画头像与名字; face: 发送者头像 id
type Props = { m: Message; mine: boolean; owner: boolean; act: MessageActions; selecting: boolean; selected: boolean; head: boolean; face?: string; name: string };

// 触屏没有悬停: 操作按钮常显
const HOVER_REVEAL = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100";

async function remove(m: Message, mode: "recall" | "delete"): Promise<void> {
  try {
    await api(`${fill(PATH_EVENT_BY_SEQ, String(m.seq))}?${QUERY_MODE}=${mode}`, { method: "DELETE" });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

const star = (m: Message) =>
  void favorite(m.seq)
    .then(() => toast.success("已收藏"))
    .catch((e: Error) => toast.error(e.message));

function jump(seq: number): void {
  const el = document.getElementById(`m-${seq}`);
  if (!el) return void toast("原消息不在已加载的记录里");
  el.scrollIntoView({ block: "center" });
}

export const MessageItem = memo(function MessageItem({ m, mine, owner, act, selecting, selected, head, face, name }: Props) {
  const [menu, setMenu] = useState(false);
  if (m.deleted) {
    return <p className="text-center text-xs text-muted-foreground">{m.deleted.mode === "recall" ? `${mine ? "你" : m.source.name}撤回了一条消息` : "消息已删除"}</p>;
  }
  const d = m.kind === "event" ? m.data : undefined;
  const html = d?.html ?? (m.kind === "report" ? m.data.html : undefined);
  const hit = !mine && mentionsMe(m);
  const text = textOf(m);
  const copy = () => void navigator.clipboard.writeText(text).then(() => toast.success("已复制"));
  // 右键等同安卓长按: 打开同一个菜单; 多选中右键与点击都只切换选中
  const onContext = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) return;
    e.preventDefault();
    if (selecting) act.onSelect(m);
    else setMenu(true);
  };
  const body = (
    <div id={`m-${m.seq}`} onContextMenu={onContext} className={`group flex min-w-0 flex-1 gap-2 ${mine ? "flex-row-reverse" : ""} ${head ? "mt-2" : ""}`}>
      <div className="w-8 shrink-0">{head && <UserAvatar id={face} name={name} size="sm" />}</div>
      <div className={`flex min-w-0 flex-1 flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      {head && (
        <span className="text-xs text-muted-foreground">
          {mine ? "" : `${name} · `}
          {shortTime(m.ts)}
        </span>
      )}
      {m.reply && (
        <button type="button" onClick={() => jump(m.reply!.seq)} className="max-w-[85%] truncate border-l-2 border-border pl-2 text-left text-xs text-muted-foreground hover:text-foreground">
          {m.reply.src}: {m.reply.text}
        </button>
      )}
      <div className={`flex max-w-[85%] items-end gap-1 ${mine ? "flex-row-reverse" : ""}`}>
        <div
          className={`min-w-0 whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"} ${hit ? "ring-2 ring-brand" : ""}`}
        >
          {m.fwd && (
            <span className="mb-1 flex items-center gap-1 text-xs opacity-70">
              <Forward className="size-3" />
              转发自 {m.fwd.src}
            </span>
          )}
          {richText(text)}
          {d?.url && (
            <a href={d.url} {...EXTERNAL} className="mt-1 block truncate text-xs underline">
              {d.url}
            </a>
          )}
        </div>
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="更多操作" className={selecting ? "invisible" : HOVER_REVEAL}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? "end" : "start"}>
            <DropdownMenuItem onSelect={copy}>
              <Copy />
              复制
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act.onForward(m)}>
              <Forward />
              转发
            </DropdownMenuItem>
            {owner && d?.file && (
              <DropdownMenuItem onSelect={() => void saveFile(d.file!).then((dir) => toast.success(`已存到网盘 ${dir}`), (e: Error) => toast.error(e.message))}>
                <HardDrive />
                存到网盘
              </DropdownMenuItem>
            )}
            {owner && (
              <DropdownMenuItem onSelect={() => star(m)}>
                <Star />
                收藏
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => act.onReply(m)}>
              <CornerUpLeft />
              回复
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act.onSelect(m)}>
              <CheckSquare />
              多选
            </DropdownMenuItem>
            {mine && (
              <DropdownMenuItem onSelect={() => void remove(m, "recall")}>
                <Undo2 />
                撤回
              </DropdownMenuItem>
            )}
            {owner && (
              <DropdownMenuItem variant="destructive" onSelect={() => void remove(m, "delete")}>
                <Trash2 />
                删除
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {d?.file && <FileView file={d.file} />}
      {d?.bundle && <BundleCard b={d.bundle} via={[m.seq]} />}
      {html && <HtmlCard html={html} />}
      </div>
    </div>
  );
  if (!selecting) return body;
  return (
    <div className="flex items-start gap-2" onClick={() => act.onSelect(m)}>
      <Checkbox className={head ? "mt-8" : "mt-2"} checked={selected} aria-label="选中" onClick={(e) => e.stopPropagation()} onCheckedChange={() => act.onSelect(m)} />
      {body}
    </div>
  );
});

// 本地还没确认的消息: 发送中淡显, 失败时给重试与放弃
export function PendingItem({ p, onRetry, onDiscard }: { p: Pending; onRetry: () => void; onDiscard: () => void }) {
  return (
    <div className="flex flex-col items-end gap-1 pr-10">
      {p.reply && <span className="max-w-[85%] truncate border-l-2 border-border pl-2 text-xs text-muted-foreground">{textOf(p.reply).split("\n")[0]}</span>}
      <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground ${p.failed ? "" : "opacity-60"}`}>{p.text}</div>
      {p.failed ? (
        <span className="flex items-center gap-2 text-xs text-destructive">
          发送失败
          <Button size="xs" variant="ghost" onClick={onRetry}>
            <RotateCcw />
            重试
          </Button>
          <Button size="xs" variant="ghost" onClick={onDiscard}>
            放弃
          </Button>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">发送中</span>
      )}
    </div>
  );
}
