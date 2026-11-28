import { Button } from "@hx/ui/ui/button";
import { Chip, ChipGroup } from "@hx/ui/ui/chip-group";
import { AnimatePresence, m } from "motion/react";
import { HardDrive } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAttention, useUser } from "../../app/hooks";
import { link } from "../../app/router";
import { Agents } from "./Agents";
import { Hero, Kpis } from "./Hero";
import { Hosts } from "./Hosts";
import { Heat, Mix, Rhythm } from "./Insights";
import { Layer, NeedMe } from "./Layers";
import { Pulse } from "./Pulse";
import { ServerBoard } from "./Server";

const BOARDS = [
  { id: "daily", label: "日常" },
  { id: "server", label: "服务器" },
] as const;
type Board = (typeof BOARDS)[number]["id"];
const BOARD_KEY = "aioa.overview.board";
const NEED_ME = "need-me";
const readBoard = (): Board => (BOARDS.some((b) => b.id === localStorage.getItem(BOARD_KEY)) ? (localStorage.getItem(BOARD_KEY) as Board) : "daily");
const EASE = [0.22, 1, 0.36, 1] as const;

// 总览 (对照安卓 OverviewPage + OverviewV2, #121 #138 #155): 问候与结论, 五项指标, 再往下是一张随屏宽变列数的看板:
// 你和 Agent 一起, 活跃时段, 需要我, 消息来源, 活跃日历, 群 Agent, 资源, 正在发生, 值得一看。
// 只放所有人都有的内置内容; 插件 (待办, GitHub 等) 的东西走插件自己的空间, 不进这里。
export default function Overview() {
  const owner = useUser()?.role === "owner";
  const att = useAttention();
  const [board, setBoard] = useState<Board>(readBoard);
  const pick = (b: string) => {
    setBoard(b as Board);
    localStorage.setItem(BOARD_KEY, b);
  };
  const toNeedMe = () => document.getElementById(NEED_ME)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const actions = owner && (
    <>
      <ChipGroup type="single" variant="soft" value={board} onValueChange={(v) => v && pick(v)}>
        {BOARDS.map((b) => (
          <Chip key={b.id} value={b.id}>
            {b.label}
          </Chip>
        ))}
      </ChipGroup>
      <Button asChild size="sm" variant="outline" className="rounded-xl bg-background/50">
        <a href={link("overview", "drive")}>
          <HardDrive />
          网盘
        </a>
      </Button>
    </>
  );

  return (
    <div className="relative h-full w-full overflow-y-auto">
      <div className="relative mx-auto flex w-full max-w-none flex-col gap-5 px-4 pt-6 pb-12 sm:px-6 lg:px-8 3xl:gap-6 3xl:px-10">
        <Hero actions={actions || undefined} />
        <Kpis onNeedMe={toNeedMe} />
        <AnimatePresence mode="wait" initial={false}>
          {board === "server" && owner ? (
            <m.div key="server" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.35, ease: EASE }}>
              <ServerBoard />
            </m.div>
          ) : (
            <m.div key="daily" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.35, ease: EASE }} className="ov-grid">
              <Cell i={0} className="ov-pulse">
                <Pulse />
              </Cell>
              <Cell i={1} className="ov-rhythm">
                <Rhythm />
              </Cell>
              <Cell i={2} className="ov-need" id={NEED_ME}>
                <NeedMe waiting={att.waiting} />
              </Cell>
              <Cell i={3} className="ov-mix">
                <Mix />
              </Cell>
              <Cell i={4} className="ov-heat">
                <Heat />
              </Cell>
              <Cell i={5} className="ov-agents">
                <Agents />
              </Cell>
              <Cell i={6} className="ov-hosts">
                <Hosts />
              </Cell>
              <Cell i={7} className="ov-happening">
                <Layer priority="happening" />
              </Cell>
              <Cell i={8} className="ov-reading">
                <Layer priority="worth_reading" />
              </Cell>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// 看板里的一格: 依次浮上来, 带一点缩放与模糊
function Cell({ i, className, id, children }: { i: number; className: string; id?: string; children: ReactNode }) {
  return (
    <m.section
      id={id}
      className={`${className} empty:hidden`}
      initial={{ opacity: 0, y: 18, scale: 0.985, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      transition={{ delay: 0.12 + i * 0.05, duration: 0.55, ease: EASE }}
    >
      {children}
    </m.section>
  );
}
