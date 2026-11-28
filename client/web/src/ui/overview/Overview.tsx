import { Stagger, StaggerItem } from "@hx/ui/motion";
import { NumberRoll } from "@hx/ui/text/number-roll";
import { Button } from "@hx/ui/ui/button";
import { Card } from "@hx/ui/ui/card";
import { Chip, ChipGroup } from "@hx/ui/ui/chip-group";
import { Activity, BellRing, Bot, HardDrive, MessageSquare, Server, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAttention, useChats, useFeed, useResources, useUser } from "../../app/hooks";
import { link } from "../../app/router";
import { chats } from "../../core/chats";
import { CLOUD_AGENT_LABEL, LOCALE } from "../../core/constants";
import { Agents } from "./Agents";
import { DevBoard } from "./Dev";
import { Hosts } from "./Hosts";
import { Sources } from "./Insights";
import { Layer, NeedMe } from "./Layers";
import { TONE, tint } from "./parts";
import { Pulse } from "./Pulse";
import { Rhythm } from "./Rhythm";
import { ServerBoard } from "./Server";

const BOARDS = [
  { id: "daily", label: "日常" },
  { id: "dev", label: "开发" },
  { id: "server", label: "服务器" },
] as const;
type Board = (typeof BOARDS)[number]["id"];
const BOARD_KEY = "aioa.overview.board";
const NEED_ME = "need-me";
const INT = { maximumFractionDigits: 0 } as const;
const readBoard = (): Board => (BOARDS.some((b) => b.id === localStorage.getItem(BOARD_KEY)) ? (localStorage.getItem(BOARD_KEY) as Board) : "daily");

// 总览 (对照安卓 OverviewPage + OverviewV2, #121 #138 #155): 日常 / 开发 (GitHub) / 服务器三个看板, 同安卓; 五项计数, 然后需要我放在最前, 活跃, 消息来源, 正在发生, 值得一看, 群 Agent, 资源。
// 中性底色, 颜色只表达状态; 只放所有人都有的内置内容, 插件 (待办, GitHub 等) 不进这里。
export default function Overview() {
  const owner = useUser()?.role === "owner";
  const [board, setBoard] = useState<Board>(readBoard);
  const pick = (b: string) => {
    setBoard(b as Board);
    localStorage.setItem(BOARD_KEY, b);
  };
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="flex w-full flex-col gap-4 p-4 md:p-6 3xl:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-muted-foreground">{new Date().toLocaleDateString(LOCALE, { month: "long", day: "numeric", weekday: "long" })}</p>
          {owner && (
            <>
              <ChipGroup type="single" size="sm" variant="soft" value={board} onValueChange={(v) => v && pick(v)}>
                {BOARDS.map((b) => (
                  <Chip key={b.id} value={b.id}>
                    {b.label}
                  </Chip>
                ))}
              </ChipGroup>
              <Button asChild size="sm" variant="outline">
                <a href={link("overview", "drive")}>
                  <HardDrive />
                  网盘
                </a>
              </Button>
            </>
          )}
        </div>
        <Stats />
        {board === "server" && owner ? <ServerBoard /> : board === "dev" && owner ? <DevBoard /> : <Daily />}
      </div>
    </div>
  );
}

// 日常看板: 1280 起 12 列, 2K / 4K (3xl) 起同一行多放几块
function Daily() {
  const att = useAttention();
  return (
    <Stagger className="grid grid-flow-row-dense grid-cols-1 gap-4 xl:grid-cols-12" gap={0.04}>
      <StaggerItem id={NEED_ME} className="xl:col-span-5 3xl:col-span-4">
        <NeedMe waiting={att.waiting} />
      </StaggerItem>
      <StaggerItem className="xl:col-span-7 3xl:col-span-5">
        <Pulse />
      </StaggerItem>
      <StaggerItem className="xl:col-span-4 3xl:col-span-3">
        <Sources />
      </StaggerItem>
      <StaggerItem className="xl:col-span-4 3xl:col-span-4">
        <Layer priority="happening" />
      </StaggerItem>
      <StaggerItem className="xl:col-span-4 3xl:col-span-3">
        <Layer priority="worth_reading" />
      </StaggerItem>
      <StaggerItem className="xl:col-span-7 3xl:col-span-5">
        <Rhythm />
      </StaggerItem>
      <StaggerItem className="xl:col-span-5 3xl:col-span-6 empty:hidden">
        <Agents />
      </StaggerItem>
      <StaggerItem className="xl:col-span-12 3xl:col-span-6">
        <Hosts />
      </StaggerItem>
    </Stagger>
  );
}

function Stats() {
  const att = useAttention();
  const snap = useFeed();
  const { hosts, probes } = useResources();
  useChats();
  const tasks = Object.values(snap.tasks);
  const running = tasks.filter((t) => t.state === "running").length;
  const metas = chats.ordered();
  const unread = metas.reduce((n, c) => n + (c.muted ? 0 : Math.max(0, chats.unread(c))), 0);
  const agents = metas.reduce((n, c) => n + (c.agents?.length ?? 0), 0);
  const groups = metas.filter((c) => c.agents?.length).length;
  const live = new Set(probes);
  const up = hosts.filter((h) => live.has(h.subject) || h.online).length;
  const toNeedMe = () => document.getElementById(NEED_ME)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      <Stat label="需要我" icon={BellRing} tone={att.total ? TONE.danger : TONE.success} value={att.total} alert={att.total > 0} hint={att.waiting.length ? `${att.waiting.length} 个任务等你确认` : "没有等你确认的任务"} onClick={toNeedMe} />
      <Stat label="任务在跑" icon={Activity} tone={TONE.primary} value={running} hint={`共 ${tasks.length} 个任务`} to={link("agent")} />
      <Stat label="未读消息" icon={MessageSquare} tone={TONE.amber} value={unread} hint={`${metas.length} 个会话`} to={link("chat")} />
      <Stat label="主机在线" icon={Server} tone={TONE.teal} value={up} suffix={hosts.length ? ` / ${hosts.length}` : undefined} hint={hosts.length ? `${hosts.length - up} 台离线` : "还没有探针"} to={link("res")} />
      <Stat label={CLOUD_AGENT_LABEL} icon={Bot} tone={TONE.accent} value={agents} hint={`分布在 ${groups} 个群`} to={link("chat")} />
    </div>
  );
}

type StatProps = { label: string; icon: LucideIcon; tone: string; value: number; suffix?: string; hint: ReactNode; alert?: boolean; to?: string; onClick?: () => void };

// 一项计数: 说明 + 着色图标块 (对照安卓), 大号等宽数字, 一行补充; 需要我不为 0 时数字变红
function Stat({ label, icon: Icon, tone, value, suffix, hint, alert, to, onClick }: StatProps) {
  const body = (
    <Card className="h-full gap-2 py-4 transition-colors hover:bg-muted/40">
      <div className="flex items-center justify-between px-4 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="grid size-7 place-items-center rounded-md [&_svg]:size-3.5" style={{ color: tone, background: tint(tone) }}>
          <Icon />
        </span>
      </div>
      <div className="flex items-baseline px-4">
        <NumberRoll value={value} format={INT} className={`text-2xl font-semibold tracking-tight tabular-nums ${alert ? "text-destructive" : ""}`} />
        {suffix && <span className="text-sm text-muted-foreground tabular-nums">{suffix}</span>}
      </div>
      <div className="truncate px-4 text-xs text-muted-foreground">{hint}</div>
    </Card>
  );
  return to ? (
    <a href={to} className="block rounded-xl">
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className="block rounded-xl text-left">
      {body}
    </button>
  );
}
