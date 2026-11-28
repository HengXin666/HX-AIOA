import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@hx/ui/ui/tabs";
import { HardDrive } from "lucide-react";
import { useState } from "react";
import { useChats, useFeed, useLinkState, useUser } from "../../app/hooks";
import { link } from "../../app/router";
import { chats } from "../../core/chats";
import { CLOUD_AGENT_LABEL, LOCALE } from "../../core/constants";
import { Agents } from "./Agents";
import { Hosts } from "./Hosts";
import { Layer, NeedMe } from "./Layers";
import { Pulse } from "./Pulse";
import { ServerBoard } from "./Server";

const BOARDS = [
  { id: "daily", label: "日常" },
  { id: "server", label: "服务器" },
] as const;
type Board = (typeof BOARDS)[number]["id"];
const BOARD_KEY = "aioa.overview.board";

// 总览 (对照安卓 OverviewV2 + OverviewBoards, #121 #138): 只放所有人都有的内置内容; 插件 (待办, GitHub 等) 的东西走插件自己的空间, 不进这里
export default function Overview() {
  const snap = useFeed();
  const state = useLinkState();
  const owner = useUser()?.role === "owner";
  useChats();
  const [board, setBoard] = useState<Board>(() => BOARDS.some((b) => b.id === localStorage.getItem(BOARD_KEY)) ? (localStorage.getItem(BOARD_KEY) as Board) : "daily");
  const pick = (b: string) => {
    setBoard(b as Board);
    localStorage.setItem(BOARD_KEY, b);
  };
  const tasks = Object.values(snap.tasks);
  const waiting = tasks.filter((t) => t.state === "waiting").sort((a, b) => b.updated - a.updated);
  const running = tasks.filter((t) => t.state === "running").length;
  const needMe = (snap.layers.need_me?.length ?? 0) + waiting.length;
  const agents = chats.ordered().reduce((n, c) => n + (c.agents?.length ?? 0), 0);
  const online = state === "online";

  return (
    <div className="h-full w-full overflow-y-auto bg-muted/30">
      <Tabs value={board} onValueChange={pick} className="mx-auto w-full max-w-7xl gap-4 p-4 pb-8">
        <header className="flex w-full flex-wrap items-end gap-x-4 gap-y-3">
          <div className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-1">
            <span className="text-sm text-muted-foreground">{new Date().toLocaleDateString(LOCALE, { weekday: "long", month: "long", day: "numeric" })}</span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{needMe > 0 ? `${needMe} 件事等你决定` : "一切正常"}</h1>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" dot={online ? "success" : "destructive"} live={online}>
                {online ? "已连接" : "未连接, 正在重连"}
              </Badge>
              {online && `${agents} 个${CLOUD_AGENT_LABEL} · ${running} 个任务在跑`}
            </span>
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
        <TabsContent value="daily" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Pulse needMe={needMe} />
          <NeedMe snap={snap} waiting={waiting} className="lg:col-span-4" />
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
