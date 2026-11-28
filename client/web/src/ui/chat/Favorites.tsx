import type { Favorite } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@hx/ui/ui/sheet";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { nav } from "../../app/router";
import { groupOf, textOf, type Message } from "../../core/chats";
import { TXT_LOADING } from "../../core/constants";
import { link } from "../../core/link";
import { favorites, unfavorite } from "../../core/msg-actions";
import { shortTime } from "../ChatList";

// 收藏 (对照安卓 ch-fav): 按引用存, 点一条回原群定位; 别的设备改了收到 chat_sync 再拉
export default function Favorites({ side, onClose }: { side: "right" | "bottom"; onClose: () => void }) {
  const [items, setItems] = useState<Favorite[] | null>(null);
  useEffect(() => {
    const load = () =>
      void favorites()
        .then(setItems)
        .catch((e: Error) => toast.error(e.message));
    load();
    return link.frames.on((f) => f.t === "chat_sync" && f.topic === "favorites" && load());
  }, []);

  const open = (f: Favorite) => {
    const g = groupOf(f.ev);
    if (!g || f.gone) return;
    onClose();
    nav("chat", g, String(f.seq));
  };
  const remove = (seq: number) => {
    setItems((old) => old?.filter((x) => x.seq !== seq) ?? null);
    void unfavorite(seq).catch((e: Error) => toast.error(e.message));
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={side} className="flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>收藏</SheetTitle>
          <SheetDescription>{items ? `${items.length} 条` : TXT_LOADING}</SheetDescription>
        </SheetHeader>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {items?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">还没有收藏</li>}
          {items?.map((f) => (
            <li key={f.seq} className="group flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted">
              <button type="button" className="min-w-0 flex-1 text-left disabled:opacity-60" disabled={f.gone} onClick={() => open(f)}>
                <p className="line-clamp-3 text-sm break-words whitespace-pre-wrap text-foreground">{f.ev.kind === "metric" ? f.ev.source.name : textOf(f.ev as Message)}</p>
                <p className="text-xs text-muted-foreground">
                  {f.ev.source.name} · {shortTime(f.ev.ts)}
                  {f.gone ? " · 原消息已不在" : ""}
                </p>
              </button>
              <Button size="icon-xs" variant="ghost" aria-label="取消收藏" onClick={() => remove(f.seq)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
