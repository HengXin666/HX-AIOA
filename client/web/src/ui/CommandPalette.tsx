import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@hx/ui/ui/command";
import { Activity, Cloud, GitBranch, LayoutDashboard, MessageSquare, Settings, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useChats, useUser } from "../app/hooks";
import { go, type Route } from "../app/router";
import { chats, titleOf } from "../core/chats";
import { UserAvatar } from "./UserAvatar";

type Page = { label: string; route: Route; icon: ReactNode; owner?: boolean };
const PAGES: Page[] = [
  { label: "消息", route: { name: "chats" }, icon: <MessageSquare /> },
  { label: "总览", route: { name: "overview" }, icon: <LayoutDashboard /> },
  { label: "资源 · 主机", route: { name: "res", tab: "hosts" }, icon: <Server /> },
  { label: "资源 · CF 额度", route: { name: "res", tab: "cf" }, icon: <Cloud />, owner: true },
  { label: "资源 · GitHub", route: { name: "res", tab: "gh" }, icon: <GitBranch /> },
  { label: "设置", route: { name: "settings" }, icon: <Settings /> },
];

// Ctrl+K: 搜会话, 跳页面; 懒加载, 首屏不带 cmdk
export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  useChats();
  const user = useUser();
  const pick = (r: Route) => {
    onOpenChange(false);
    go(r);
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="命令面板" description="搜会话, 跳页面">
      <CommandInput placeholder="搜会话或页面" />
      <CommandList>
        <CommandEmpty>没有匹配的结果</CommandEmpty>
        <CommandGroup heading="会话">
          {chats.ordered().map((c) => (
            <CommandItem key={c.channel} value={`chat ${titleOf(c)} ${c.channel}`} onSelect={() => pick({ name: "chat", channel: c.channel })}>
              <UserAvatar id={c.avatar} name={titleOf(c)} size="sm" />
              {titleOf(c)}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="页面">
          {PAGES.filter((p) => !p.owner || user?.role === "owner").map((p) => (
            <CommandItem key={p.label} value={`page ${p.label}`} onSelect={() => pick(p.route)}>
              {p.icon}
              {p.label}
            </CommandItem>
          ))}
          <CommandItem value="page 连接状态" onSelect={() => pick({ name: "settings" })}>
            <Activity />
            连接状态
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
