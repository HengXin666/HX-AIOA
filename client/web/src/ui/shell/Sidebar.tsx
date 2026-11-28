import { ChevronsUpDown, Search } from "lucide-react";
import { useLinkState, useMyFace, useUser, type Layout } from "../../app/hooks";
import { link, type AreaId } from "../../app/router";
import { UserAvatar } from "../UserAvatar";
import { CountBadge, IconTile, NAV, useNavCounts, useNavKeys } from "./nav";

const LINK_TEXT: Record<string, string> = { idle: "准备连接", online: "已连接", connecting: "连接中", offline: "未连接, 正在重连" };

// 电脑侧栏: 宽屏 248px 带文字与计数, 中屏 64px 只留图标块与角标
export function Rail({ layout, area, onSearch }: { layout: Layout; area: AreaId; onSearch: () => void }) {
  const counts = useNavCounts();
  useNavKeys();
  const wide = layout === "wide";
  return (
    <nav aria-label="主导航" className={`side-surface relative flex shrink-0 flex-col border-r border-sidebar-border ${wide ? "w-[248px] px-3" : "w-16 items-center px-2"} py-3`}>
      <Brand wide={wide} />
      <button
        type="button"
        onClick={onSearch}
        title={wide ? undefined : "搜索 (Ctrl+K)"}
        className={`mt-3 flex h-8 items-center gap-2 rounded-lg border border-sidebar-border bg-background/60 text-muted-foreground transition-colors hover:border-ring/40 hover:text-foreground [&_svg]:size-3.5 ${wide ? "w-full px-2.5 text-xs" : "w-10 justify-center"}`}
      >
        <Search />
        {wide && (
          <>
            <span className="flex-1 text-left">搜索会话与页面</span>
            <kbd className="rounded border border-sidebar-border bg-muted px-1 font-mono text-[10px] leading-4">Ctrl K</kbd>
          </>
        )}
      </button>
      {wide && <p className="mt-5 mb-1.5 px-2 text-[11px] font-medium tracking-wide text-muted-foreground/80">工作台</p>}
      <ul className={`flex flex-col gap-0.5 ${wide ? "" : "mt-4 items-center gap-1.5"}`}>
        {NAV.map((n) => {
          const on = n.area === area;
          const c = counts[n.area];
          return (
            <li key={n.area} className={wide ? "" : "relative"}>
              <a
                href={link(n.area)}
                aria-current={on ? "page" : undefined}
                aria-label={n.label}
                title={wide ? undefined : `${n.label} (Alt+${n.key})`}
                className={`nav-row group relative flex items-center rounded-lg transition-colors ${on ? "is-on" : ""} ${wide ? "h-9 gap-2.5 px-1.5 text-[13px]" : "size-10 justify-center"}`}
              >
                {on && <span aria-hidden className={`absolute top-2 bottom-2 w-[3px] rounded-full ${wide ? "-left-3" : "-left-2"}`} style={{ background: n.tone }} />}
                <IconTile tone={n.tone} active={on}>
                  {n.icon}
                </IconTile>
                {wide && <span className={`flex-1 truncate ${on ? "font-semibold text-foreground" : "font-medium text-sidebar-foreground/80 group-hover:text-foreground"}`}>{n.label}</span>}
                {wide && !c && <kbd className="hidden font-mono text-[10px] text-muted-foreground group-hover:inline">Alt {n.key}</kbd>}
                {wide && <CountBadge c={c} />}
                {!wide && c && (
                  <span className="absolute -top-0.5 -right-0.5">
                    <CountBadge c={c} compact />
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      <Me wide={wide} />
    </nav>
  );
}

function Brand({ wide }: { wide: boolean }) {
  const state = useLinkState();
  const online = state === "online";
  return (
    <a href={link("overview")} className={`flex items-center gap-2.5 rounded-lg ${wide ? "px-1.5 py-1" : "justify-center"}`} title={wide ? undefined : LINK_TEXT[state]}>
      <span className="brand-mark relative grid size-8 shrink-0 place-items-center rounded-[10px] text-[11px] font-bold tracking-tight text-white">
        HX
        <span aria-hidden className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar ${online ? "bg-success" : "bg-destructive"}`} />
      </span>
      {wide && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-foreground">HX-AIOA</span>
          <span className={`text-[11px] ${online ? "text-muted-foreground" : "text-destructive"}`}>{LINK_TEXT[state] ?? state}</span>
        </span>
      )}
    </a>
  );
}

function Me({ wide }: { wide: boolean }) {
  const user = useUser();
  const face = useMyFace();
  const role = user?.role === "owner" ? "主人" : "成员";
  return (
    <a
      href={link("me")}
      title={wide ? undefined : user?.display}
      className={`mt-auto flex items-center gap-2.5 rounded-xl border border-transparent transition-colors hover:border-sidebar-border hover:bg-background/60 ${wide ? "p-1.5" : "justify-center p-1"}`}
    >
      <UserAvatar id={face} name={user?.display ?? ""} size="sm" />
      {wide && (
        <>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-medium text-foreground">{user?.display}</span>
            <span className="text-[11px] text-muted-foreground">{role}</span>
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </>
      )}
    </a>
  );
}

// 手机底栏: 选中项图标块上色, 计数角标与侧栏同源
export function BottomNav({ area }: { area: AreaId }) {
  const counts = useNavCounts();
  return (
    <nav aria-label="主导航" className="safe-bottom side-surface flex border-t border-sidebar-border">
      {NAV.map((n) => {
        const on = n.area === area;
        const c = counts[n.area];
        return (
          <a key={n.area} href={link(n.area)} aria-current={on ? "page" : undefined} className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] ${on ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            <span className="relative">
              <IconTile tone={n.tone} active={on} size="sm">
                {n.icon}
              </IconTile>
              {c && (
                <span className="absolute -top-1 -right-1.5">
                  <CountBadge c={c} compact={c.n < 0} />
                </span>
              )}
            </span>
            {n.label}
          </a>
        );
      })}
    </nav>
  );
}
