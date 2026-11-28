import { Button } from "@hx/ui/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@hx/ui/ui/tabs";
import { Activity, BellRing, Bot, HardDrive, MessageSquare, Server } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAttention, useChats, useFeed, useLinkState, useResources, useUser } from "../../app/hooks";
import { link } from "../../app/router";
import { chats } from "../../core/chats";
import { CLOUD_AGENT_LABEL, LOCALE } from "../../core/constants";
import { IconTile } from "../shell/nav";
import { Agents } from "./Agents";
import { Hosts } from "./Hosts";
import { Layer, NeedMe } from "./Layers";
import { TONE } from "./parts";
import { Pulse } from "./Pulse";
import { ServerBoard } from "./Server";

const BOARDS = [
  { id: "daily", label: "日常" },
  { id: "server", label: "服务器" },
] as const;
type Board = (typeof BOARDS)[number]["id"];
const BOARD_KEY = "aioa.overview.board";

// 总览 (对照安卓 OverviewV2): 顶部一条事实带, 每格都是能点进去核对的真实计数
export default function Overview() {
  const snap = useFeed();
  const att = useAttention();
  const state = useLinkState();
  const owner = useUser()?.role === "owner";
  const { hosts, probes } = useResources();
  useChats();
  const [board, setBoard] = useState<Board>(() => BOARDS.some((b) => b.id === localStorage.getItem(BOARD_KEY)) ? (localStorage.getItem(BOARD_KEY) as Board) : "daily");
  const pick = (b: string) => {
    setBoard(b as Board);
    localStorage.setItem(BOARD_KEY, b);
  };
  const running = Object.values(snap.tasks).filter((t) => t.state === "running").length;
  const metas = chats.ordered();
  const unread = metas.reduce((n, c) => n + (c.muted ? 0 : Math.max(0, chats.unread(c))), 0);
  const agents = metas.reduce((n, c) => n + (c.agents?.length ?? 0), 0);
  const live = new Set(probes);
  const up = hosts.filter((h) => live.has(h.subject) || h.online).length;
  const online = state === "online";
  const headline = !snap.loaded ? "正在同步" : att.total > 0 ? `${att.total} 件事要你处理` : "没有要你处理的事";

  return (
    <div className="h-full w-full overflow-y-auto">
      <Tabs value={board} onValueChange={pick} className="mx-auto w-full max-w-7xl gap-3 px-4 pt-4 pb-8">
        <header className="flex w-full flex-wrap items-end gap-x-4 gap-y-2">
          <div className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString(LOCALE, { weekday: "long", month: "long", day: "numeric" })}
              {!online && <span className="ml-2 text-destructive">未连接, 数据可能不是最新</span>}
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{headline}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList>
              {BOARDS.map((b) => (
                <TabsTrigger key={b.id} value={b.id}>
                  {b.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {owner && (
              <Button asChild size="sm" variant="outline">
                <a href={link("overview", "drive")}>
                  <HardDrive />
                  网盘
                </a>
              </Button>
            )}
          </div>
        </header>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
          <Stat icon={<BellRing />} tone={att.total ? TONE.danger : TONE.muted} value={att.total} label="需要我" onClick={() => document.getElementById("need-me")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
          <Stat icon={<Activity />} tone={TONE.info} value={running} label="任务在跑" to={link("agent")} />
          <Stat icon={<MessageSquare />} tone={TONE.success} value={unread} label="条未读" to={link("chat")} />
          <Stat icon={<Server />} tone={TONE.warning} value={hosts.length ? `${up}/${hosts.length}` : "0"} label="主机在线" to={link("res")} />
          <Stat icon={<Bot />} tone={TONE.accent} value={agents} label={CLOUD_AGENT_LABEL} to={link("chat")} />
        </div>
        <TabsContent value="daily" className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <NeedMe snap={snap} items={att.items} waiting={att.waiting} className="lg:col-span-5" />
          <Pulse />
          <Agents />
          <Hosts className="lg:col-span-12" />
          <Layer snap={snap} priority="happening" className="lg:col-span-6" />
          <Layer snap={snap} priority="worth_reading" className="lg:col-span-6" />
        </TabsContent>
        <TabsContent value="server">{board === "server" && (owner ? <ServerBoard /> : <p className="text-sm text-muted-foreground">服务器看板只有主人能看</p>)}</TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ icon, tone, value, label, to, onClick }: { icon: ReactNode; tone: string; value: ReactNode; label: string; to?: string; onClick?: () => void }) {
  const body = (
    <>
      <IconTile tone={tone}>{icon}</IconTile>
      <span className="flex min-w-0 flex-col text-left leading-tight">
        <span className="text-lg font-semibold text-foreground tabular-nums">{value}</span>
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </>
  );
  const cls = "stat-cell flex items-center gap-3 px-4 py-3";
  return to ? (
    <a href={to} className={cls}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}
