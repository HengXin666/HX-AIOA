import { LiveDot } from "@hx/ui/effects/live-dot";
import { useTheme } from "@hx/ui/theme";
import { m } from "motion/react";
import { Moon, Search, Sun } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { useChats, useFeed, useLinkState, useMyFace, useResources, useUser } from "../../app/hooks";
import { href, link } from "../../app/router";
import { chats, textOf, titleOf } from "../../core/chats";
import { shortTime } from "../ChatList";
import { UserAvatar } from "../UserAvatar";
import { hourly, useActivity } from "./activity";

const LINK_TEXT: Record<string, string> = { idle: "准备连接", online: "已连接 · 实时", connecting: "连接中", offline: "未连接, 正在重连" };
const RECENT = 5;
const TONE_INFO = "var(--info)";

export function Brand({ wide }: { wide: boolean }) {
  const state = useLinkState();
  const online = state === "online";
  return (
    <a href={link("overview")} className={`flex items-center gap-3 rounded-xl ${wide ? "px-1 py-1" : "justify-center"}`} title={wide ? undefined : LINK_TEXT[state]}>
      <span className="relative shrink-0">
        <span className="brand-orb size-9 text-[12px] font-bold tracking-tight text-white">HX</span>
        <span aria-hidden className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar ${online ? "bg-success shadow-[0_0_8px_var(--success)]" : "bg-destructive"}`} />
      </span>
      {wide && (
        <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
          <span className="brand-word text-[15px] font-bold tracking-tight">HX-AIOA</span>
          <span className={`flex items-center gap-1.5 text-[11px] ${online ? "text-muted-foreground" : "text-destructive"}`}>
            <LiveDot tone={online ? "success" : "destructive"} live={online} />
            {LINK_TEXT[state] ?? state}
          </span>
        </span>
      )}
    </a>
  );
}

export function SearchButton({ wide, onSearch }: { wide: boolean; onSearch: () => void }) {
  return (
    <button
      type="button"
      onClick={onSearch}
      title={wide ? undefined : "搜索 (Ctrl+K)"}
      aria-label="搜索"
      className={`group mt-4 flex h-9 shrink-0 items-center gap-2 rounded-xl border border-sidebar-border bg-background/50 text-muted-foreground transition-all hover:border-ring/50 hover:bg-background/80 hover:text-foreground hover:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_14%,transparent)] [&_svg]:size-4 ${wide ? "w-full px-3 text-[12.5px]" : "w-11 justify-center"}`}
    >
      <Search className="transition-transform group-hover:scale-110" />
      {wide && (
        <>
          <span className="flex-1 text-left">搜索会话与页面</span>
          <kbd className="num rounded-md border border-sidebar-border bg-muted/60 px-1.5 text-[10px] leading-5">Ctrl K</kbd>
        </>
      )}
    </button>
  );
}

// 实时卡: 24 小时消息走势 + 三项计数 (在跑任务, 等我确认, 主机在线), 下沿细条按占比填充
export function LiveCard() {
  const events = useActivity();
  const snap = useFeed();
  const { hosts, probes } = useResources();
  const hours = useMemo(() => hourly(events), [events]);
  const today = hours.reduce((a, b) => a + b, 0);
  const tasks = Object.values(snap.tasks);
  const running = tasks.filter((t) => t.state === "running").length;
  const waiting = tasks.filter((t) => t.state === "waiting").length;
  const live = new Set(probes);
  const up = hosts.filter((h) => live.has(h.subject) || h.online).length;
  return (
    <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="pulse-card mt-5 flex shrink-0 flex-col gap-2.5 rounded-2xl p-3">
      <div className="flex items-baseline justify-between">
        <span className="rail-label !tracking-[0.1em] after:hidden">近 24 小时</span>
        <span className="num text-[11px] text-muted-foreground">
          <span className="text-sm font-semibold text-foreground">{events ? today : "-"}</span> 条
        </span>
      </div>
      <HourBars hours={hours} />
      <div className="grid grid-cols-3 gap-2">
        <Mini label="在跑" value={running} of={Math.max(1, tasks.length)} tone="var(--chart-2)" />
        <Mini label="待确认" value={waiting} of={Math.max(1, tasks.length)} tone="var(--destructive)" />
        <Mini label="主机" value={up} of={Math.max(1, hosts.length)} tone="var(--success)" text={hosts.length ? `${up}/${hosts.length}` : "0"} />
      </div>
    </m.div>
  );
}

// 24 根小柱, 每小时一根, 依次从底部长出来; 当前小时高亮. 侧栏在首包里, 不引图表库
function HourBars({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  const last = hours.length - 1;
  return (
    <div className="flex h-9 items-end gap-[2px]" role="img" aria-label="近 24 小时每小时的消息数">
      {hours.map((v, i) => (
        <m.span
          key={i}
          className="flex-1 origin-bottom rounded-[2px]"
          style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: v ? TONE_INFO : "var(--muted)", opacity: i === last ? 1 : v ? 0.55 + (0.45 * v) / max : 1, boxShadow: i === last && v ? `0 0 8px ${TONE_INFO}` : undefined }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ delay: 0.25 + i * 0.015, type: "spring", stiffness: 260, damping: 20 }}
        />
      ))}
    </div>
  );
}

function Mini({ label, value, of, tone, text }: { label: string; value: number; of: number; tone: string; text?: string }) {
  return (
    <div className="flex flex-col gap-1" style={{ "--tile": tone } as CSSProperties}>
      <span className="num text-[15px] leading-none font-semibold text-foreground">{text ?? value}</span>
      <span className="text-[10.5px] text-muted-foreground">{label}</span>
      <span className="pulse-bar">
        <span style={{ transform: `scaleX(${Math.min(1, value / of)})` }} />
      </span>
    </div>
  );
}

// 最近会话: 按会话库顺序 (置顶在前) 取前几个, 未读的标点
export function Recent() {
  const { last, version } = useChats();
  const list = useMemo(() => chats.ordered().slice(0, RECENT), [version]);
  if (!list.length) return null;
  return (
    <div className="mt-5 flex flex-col">
      <p className="rail-label mb-1.5 px-1.5">最近会话</p>
      {list.map((c, i) => {
        const unread = c.muted ? 0 : chats.unread(c);
        const msg = last[c.channel];
        const title = titleOf(c);
        return (
          <m.a
            key={c.channel}
            href={href({ name: "chat", channel: c.channel })}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.04 }}
            className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-foreground/5"
          >
            <UserAvatar id={c.avatar} name={title} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="flex items-center gap-1.5">
                <span className={`truncate text-[12.5px] ${unread ? "font-semibold text-foreground" : "text-sidebar-foreground/85"}`}>{title}</span>
                {msg && <span className="num ml-auto shrink-0 text-[10px] text-muted-foreground">{shortTime(msg.ts)}</span>}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">{msg ? textOf(msg).split("\n")[0] : " "}</span>
            </span>
            {unread !== 0 && <span aria-label="有未读" className="size-1.5 shrink-0 rounded-full bg-success shadow-[0_0_6px_var(--success)]" />}
          </m.a>
        );
      })}
    </div>
  );
}

export function Me({ wide }: { wide: boolean }) {
  const user = useUser();
  const face = useMyFace();
  const { resolved, setMode } = useTheme();
  const dark = resolved === "dark";
  const role = user?.role === "owner" ? "主人" : "成员";
  const flip = (
    <button
      type="button"
      onClick={() => setMode(dark ? "light" : "dark")}
      aria-label={dark ? "切到浅色" : "切到深色"}
      title={dark ? "切到浅色" : "切到深色"}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground [&_svg]:size-4"
    >
      <m.span key={resolved} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}>
        {dark ? <Moon /> : <Sun />}
      </m.span>
    </button>
  );
  if (!wide) {
    return (
      <div className="flex flex-col items-center gap-1">
        {flip}
        <a href={link("me")} title={user?.display} className="rounded-full p-0.5 transition-shadow hover:shadow-[0_0_0_2px_var(--sidebar-border)]">
          <UserAvatar id={face} name={user?.display ?? ""} size="sm" />
        </a>
      </div>
    );
  }
  return (
    <div className="pulse-card flex items-center gap-2 rounded-2xl p-1.5">
      <a href={link("me")} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 transition-colors hover:bg-foreground/5">
        <UserAvatar id={face} name={user?.display ?? ""} size="sm" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium text-foreground">{user?.display}</span>
          <span className="text-[11px] text-muted-foreground">{role}</span>
        </span>
      </a>
      {flip}
    </div>
  );
}
