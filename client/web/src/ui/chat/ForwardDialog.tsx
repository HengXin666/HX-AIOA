import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@hx/ui/ui/command";
import { toast } from "sonner";
import { useChats } from "../../app/hooks";
import { chats, titleOf, type Message } from "../../core/chats";
import { forward, forwardBundle } from "../../core/msg-actions";
import { UserAvatar } from "../UserAvatar";

export type ForwardMode = "each" | "bundle";
type Props = { items: Message[]; mode: ForwardMode; from: string; onClose: (done: boolean) => void };

// 转发到: 选一个会话 (对照安卓 ch-forward), 逐条或合并; 邮件群不收转发
export default function ForwardDialog({ items, mode, from, onClose }: Props) {
  useChats();
  const pick = (channel: string) => {
    const ok = mode === "bundle" ? forwardBundle(items, from, channel) : forward(items, channel);
    if (!ok) return void toast.error("未连接服务端, 没有转发");
    const meta = chats.meta(channel);
    toast.success(`已转发到 ${meta ? titleOf(meta) : channel}`);
    onClose(true);
  };
  const title = mode === "bundle" ? `合并转发 ${items.length} 条` : items.length > 1 ? `逐条转发 ${items.length} 条` : "转发";
  return (
    <CommandDialog open onOpenChange={(o) => !o && onClose(false)} title={title} description="选择会话">
      <CommandInput placeholder={`${title}到...`} />
      <CommandList>
        <CommandEmpty>没有匹配的会话</CommandEmpty>
        <CommandGroup heading={title}>
          {chats
            .ordered()
            .filter((c) => c.view !== "mail")
            .map((c) => (
              <CommandItem key={c.channel} value={`${titleOf(c)} ${c.channel}`} onSelect={() => pick(c.channel)}>
                <UserAvatar id={c.avatar} name={titleOf(c)} size="sm" />
                {titleOf(c)}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
