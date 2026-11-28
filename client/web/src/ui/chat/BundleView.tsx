import type { BundleInfo, Envelope } from "@hx-aioa/protocol";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@hx/ui/ui/dialog";
import { useEffect, useState } from "react";
import { textOf, type Message } from "../../core/chats";
import { TXT_LOADING } from "../../core/constants";
import { bundleItems } from "../../core/msg-actions";
import { shortTime } from "../ChatList";
import { BundleCard } from "../MessageParts";

// 合并转发详情 (对照安卓 ch-bundle): 只读, 按 refs 一次批量取; 里面再套的卡片带上外层 via
export default function BundleView({ b, via, onClose }: { b: BundleInfo; via: number[]; onClose: () => void }) {
  const [items, setItems] = useState<Envelope[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    bundleItems(b.refs, via)
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, [b, via]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{b.from} 的聊天记录</DialogTitle>
          <DialogDescription>共 {b.count} 条</DialogDescription>
        </DialogHeader>
        <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          {!items && !error && <li className="text-sm text-muted-foreground">{TXT_LOADING}</li>}
          {error && <li className="text-sm text-destructive">{error}</li>}
          {items?.map((ev) => {
            if (ev.kind === "metric") return null;
            const m = ev as Message;
            const inner = m.kind === "event" ? m.data.bundle : undefined;
            return (
              <li key={m.id} className="flex flex-col gap-1 border-b border-border py-2 last:border-0">
                <span className="text-xs text-muted-foreground">
                  {m.source.name} · {shortTime(m.ts)}
                </span>
                {m.deleted ? <span className="text-sm text-muted-foreground">消息已不在</span> : <p className="text-sm break-words whitespace-pre-wrap text-foreground">{textOf(m)}</p>}
                {inner && <BundleCard b={inner} via={[...via, m.seq]} />}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
