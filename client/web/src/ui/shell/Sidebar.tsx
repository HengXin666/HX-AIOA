import { LiveDot } from "@hx/ui/effects/live-dot";
import { useTheme } from "@hx/ui/theme";
import { Button } from "@hx/ui/ui/button";
import { Kbd } from "@hx/ui/ui/kbd";
import { Separator } from "@hx/ui/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@hx/ui/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hx/ui/ui/tooltip";
import { Moon, Search, Sun } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useChats, useLinkState, useMyFace, useUser } from "../../app/hooks";
import { href, link, type AreaId } from "../../app/router";
import { chats, titleOf } from "../../core/chats";
import { UserAvatar } from "../UserAvatar";
import { CountBadge, NAV, useNavCounts, useNavKeys } from "./nav";

const RECENT = 6;
const LINK_TEXT: Record<string, string> = { idle: "准备连接", online: "已连接", connecting: "连接中", offline: "未连接, 正在重连" };

// 电脑侧栏: HX-UI Sidebar (inset, 可收成图标栏, Ctrl+B 切换); 宽度与收起状态由组件记住
export function AppSidebar({ area }: { area: AreaId }) {
  const counts = useNavCounts();
  useNavKeys();
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="py-3">
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>工作台</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((n) => (
                <SidebarMenuItem key={n.area}>
                  <SidebarMenuButton asChild isActive={n.area === area} tooltip={`${n.label}  Alt+${n.key}`}>
                    <a href={link(n.area)} aria-current={n.area === area ? "page" : undefined}>
                      <n.icon />
                      <span>{n.label}</span>
                    </a>
                  </SidebarMenuButton>
                  {counts[n.area] && (
                    <SidebarMenuBadge>
                      <CountBadge c={counts[n.area]} />
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <Recent />
      </SidebarContent>
      <SidebarFooter>
        <Me />
      </SidebarFooter>
    </Sidebar>
  );
}

function Brand() {
  return (
    <a href={link("overview")} className="flex min-w-0 items-center gap-2.5 px-1">
      <img src="/icon-192.png" alt="" className="size-8 shrink-0 rounded-lg" />
      <span className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
        <span className="block truncate text-sm font-semibold">HX-AIOA</span>
        <span className="block truncate text-xs text-muted-foreground">消息与 Agent 工作台</span>
      </span>
    </a>
  );
}

// 最近会话: 收起成图标栏时整组隐藏
function Recent() {
  const { version } = useChats();
  const list = useMemo(() => chats.ordered().slice(0, RECENT), [version]);
  if (!list.length) return null;
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>最近会话</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {list.map((c) => {
            const unread = c.muted ? 0 : chats.unread(c);
            return (
              <SidebarMenuItem key={c.channel}>
                <SidebarMenuButton asChild size="sm">
                  <a href={href({ name: "chat", channel: c.channel })}>
                    <span className={`truncate ${unread ? "font-medium text-foreground" : "text-muted-foreground"}`}>{titleOf(c)}</span>
                  </a>
                </SidebarMenuButton>
                {unread !== 0 && <SidebarMenuBadge>{unread > 0 ? <span className="tabular-nums">{unread}</span> : <span className="size-1.5 rounded-full bg-foreground/70" />}</SidebarMenuBadge>}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function Me() {
  const user = useUser();
  const face = useMyFace();
  return (
    <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
      <SidebarMenu className="min-w-0 flex-1">
        <SidebarMenuItem>
          <SidebarMenuButton asChild size="lg" tooltip={user?.display}>
            <a href={link("me")}>
              <UserAvatar id={face} name={user?.display ?? ""} size="sm" />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-medium">{user?.display}</span>
                <span className="block truncate text-xs text-muted-foreground">{user?.role === "owner" ? "主人" : "成员"}</span>
              </span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <ThemeToggle />
    </div>
  );
}

function ThemeToggle() {
  const { resolved, setMode } = useTheme();
  const dark = resolved === "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="切换明暗" onClick={() => setMode(dark ? "light" : "dark")}>
          {dark ? <Sun /> : <Moon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{dark ? "浅色" : "深色"}</TooltipContent>
    </Tooltip>
  );
}

// 内容区顶栏: 收起侧栏, 当前栏名, 连接状态, 搜索
export function TopBar({ area, onSearch, extra }: { area: AreaId; onSearch: () => void; extra?: ReactNode }) {
  const state = useLinkState();
  const online = state === "online";
  const label = NAV.find((n) => n.area === area)?.label;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <h1 className="text-sm font-medium">{label}</h1>
      <span className={`ml-2 flex items-center gap-1.5 text-xs ${online ? "text-muted-foreground" : "text-destructive"}`}>
        <LiveDot tone={online ? "success" : "destructive"} live={online} />
        {LINK_TEXT[state] ?? state}
      </span>
      <div className="flex-1">{extra}</div>
      <Button variant="outline" size="sm" className="w-56 justify-start text-muted-foreground" onClick={onSearch}>
        <Search />
        <span className="flex-1 text-left">搜索会话与页面</span>
        <Kbd>Ctrl K</Kbd>
      </Button>
    </header>
  );
}
