import { Backdrop } from "@hx/ui/effects/backdrop";
import { LiveDot } from "@hx/ui/effects/live-dot";
import { Stagger, StaggerItem } from "@hx/ui/motion";
import { NumberRoll } from "@hx/ui/text/number-roll";
import { Button } from "@hx/ui/ui/button";
import { Chip, ChipGroup } from "@hx/ui/ui/chip-group";
import { AnimatePresence, m } from "motion/react";
import { HardDrive } from "lucide-react";
import { useState } from "react";
import { useChats, useFeed, useLinkState, useUser } from "../../app/hooks";
import { link } from "../../app/router";
import { chats } from "../../core/chats";
import { CLOUD_AGENT_LABEL, LOCALE } from "../../core/constants";
import { useSeen } from "../../core/seen";
import { Agents } from "./Agents";
import { Hosts } from "./Hosts";
import { Layer, NeedMe, visibleRows } from "./Layers";
import { Pulse } from "./Pulse";
import { ServerBoard } from "./Server";

const BOARDS = [
  { id: "daily", label: "日常" },
  { id: "server", label: "服务器" },
] as const;
type Board = (typeof BOARDS)[number]["id"];
const BOARD_KEY = "aioa.overview.board";
const readBoard = (): Board => (BOARDS.some((b) => b.id === localStorage.getItem(BOARD_KEY)) ? (localStorage.getItem(BOARD_KEY) as Board) : "daily");

// 总览 (对照安卓 OverviewPage + OverviewV2, #121 #138): 概况, 你和 Agent 一起, 需要我, 群 Agent, 资源, 正在发生, 值得一看。
// 只放所有人都有的内置内容; 插件 (待办, GitHub 等) 的东西走插件自己的空间, 不进这里。
export default function Overview() {
  const snap = useFeed();
  const state = useLinkState();
  const owner = useUser()?.role === "owner";
  useChats();
  useSeen();
  const [board, setBoard] = useState<Board>(readBoard);
  const pick = (b: string) => {
    setBoard(b as Board);
    localStorage.setItem(BOARD_KEY, b);
  };
  const tasks = Object.values(snap.tasks);
  const waiting = tasks.filter((t) => t.state === "waiting").sort((a, b) => b.updated - a.updated);
  const running = tasks.filter((t) => t.state === "running").length;
  const needMe = visibleRows(snap.layers.need_me, Date.now()).length + waiting.length;
  const agents = chats.ordered().reduce((n, c) => n + (c.agents?.length ?? 0), 0);
  const online = state === "online";

  return (
    <div className="relative h-full w-full overflow-y-auto">
      {/* 静态的品牌色光晕, 不用会一直合成的 aurora (web-arch.md 3.2) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden" aria-hidden>
        <Backdrop variant="glow" className="opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
      </div>
      <div className="relative mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 pt-6 pb-10 sm:px-6">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <m.div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-1.5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <span className="text-sm text-muted-foreground">{new Date().toLocaleDateString(LOCALE, { weekday: "long", month: "long", day: "numeric" })}</span>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {needMe > 0 ? (
                <>
                  <NumberRoll value={needMe} className="text-destructive" /> 件事等你决定
                </>
              ) : (
                "一切正常"
              )}
            </h1>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <LiveDot tone={online ? "success" : "destructive"} live={online} />
              {online ? `已连接 · ${agents} 个${CLOUD_AGENT_LABEL} · ${running} 个任务在跑` : "未连接, 正在重连"}
            </span>
          </m.div>
          <div className="flex flex-wrap items-center gap-2">
            {owner && (
              <ChipGroup type="single" variant="soft" value={board} onValueChange={(v) => v && pick(v)}>
                {BOARDS.map((b) => (
                  <Chip key={b.id} value={b.id}>
                    {b.label}
                  </Chip>
                ))}
              </ChipGroup>
            )}
            {owner && (
              <Button asChild size="sm" variant="outline" className="bg-background/60 backdrop-blur">
                <a href={link("overview", "drive")}>
                  <HardDrive />
                  网盘
                </a>
              </Button>
            )}
          </div>
        </header>
        <AnimatePresence mode="wait" initial={false}>
          {board === "server" && owner ? (
            <m.div key="server" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <ServerBoard />
            </m.div>
          ) : (
            <m.div key="daily" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12" gap={0.07}>
                <StaggerItem className="lg:col-span-8">
                  <Pulse needMe={needMe} />
                </StaggerItem>
                <StaggerItem className="lg:col-span-4">
                  <NeedMe waiting={waiting} />
                </StaggerItem>
                <StaggerItem className="lg:col-span-12">
                  <Agents />
                </StaggerItem>
                <StaggerItem className="lg:col-span-12">
                  <Hosts />
                </StaggerItem>
                <StaggerItem className="lg:col-span-6">
                  <Layer priority="happening" />
                </StaggerItem>
                <StaggerItem className="lg:col-span-6">
                  <Layer priority="worth_reading" />
                </StaggerItem>
              </Stagger>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
