import { LiveDot } from "@hx/ui/effects/live-dot";
import { Stagger, StaggerItem } from "@hx/ui/motion";
import { Button } from "@hx/ui/ui/button";
import { Chip, ChipGroup } from "@hx/ui/ui/chip-group";
import { AnimatePresence, m } from "motion/react";
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
const readBoard = (): Board => (BOARDS.some((b) => b.id === localStorage.getItem(BOARD_KEY)) ? (localStorage.getItem(BOARD_KEY) as Board) : "daily");

// 总览 (对照安卓 OverviewPage + OverviewV2, #121 #138): 概况, 你和 Agent 一起, 需要我, 群 Agent, 资源, 正在发生, 值得一看。
// 只放所有人都有的内置内容; 插件 (待办, GitHub 等) 的东西走插件自己的空间, 不进这里。
export default function Overview() {
  const snap = useFeed();
  const state = useLinkState();
  const owner = useUser()?.role === "owner";
  const att = useAttention();
  const { hosts, probes } = useResources();
  useChats();
  const [board, setBoard] = useState<Board>(readBoard);
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
    <div className="relative h-full w-full overflow-y-auto">
      <div className="relative mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 pt-5 pb-10 sm:px-6">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <m.div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-1.5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <span className="text-sm text-muted-foreground">{new Date().toLocaleDateString(LOCALE, { weekday: "long", month: "long", day: "numeric" })}</span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{headline}</h1>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <LiveDot tone={online ? "success" : "destructive"} live={online} />
              {online ? "已连接, 数据实时" : "未连接, 正在重连, 下面是上次同步的数据"}
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
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
          <Stat icon={<BellRing />} tone={att.total ? TONE.danger : TONE.muted} value={att.total} label="需要我" onClick={() => document.getElementById("need-me")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
          <Stat icon={<Activity />} tone={TONE.info} value={running} label="个任务在跑" to={link("agent")} />
          <Stat icon={<MessageSquare />} tone={TONE.success} value={unread} label="条未读消息" to={link("chat")} />
          <Stat icon={<Server />} tone={TONE.warning} value={hosts.length ? `${up}/${hosts.length}` : "0"} label="台主机在线" to={link("res")} />
          <Stat icon={<Bot />} tone={TONE.accent} value={agents} label={`个${CLOUD_AGENT_LABEL}`} to={link("chat")} />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {board === "server" && owner ? (
            <m.div key="server" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <ServerBoard />
            </m.div>
          ) : (
            <m.div key="daily" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12" gap={0.07}>
                <StaggerItem className="lg:col-span-8">
                  <Pulse />
                </StaggerItem>
                <StaggerItem className="lg:col-span-4" id="need-me">
                  <NeedMe waiting={att.waiting} />
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
