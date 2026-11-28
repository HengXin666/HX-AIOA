import { LayoutGroup, m } from "motion/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { Layout } from "../../app/hooks";
import { link, type AreaId } from "../../app/router";
import { CountBadge, IconTile, NAV, useNavCounts, useNavKeys, type Counts, type NavItem } from "./nav";
import { Brand, LiveCard, Me, Recent, SearchButton } from "./RailParts";

const RAIL_KEY = "aioa.rail.compact";
const WIDE_PX = 268;
const COMPACT_PX = 72;
const SPRING = { type: "spring", stiffness: 420, damping: 36 } as const;

// 电脑侧栏: 宽屏 268px (品牌, 搜索, 导航带说明, 实时卡, 最近会话, 我), 中屏或手动收起时 72px 只留图标
export function Rail({ layout, area, onSearch }: { layout: Layout; area: AreaId; onSearch: () => void }) {
  const counts = useNavCounts();
  useNavKeys();
  const [compact, setCompact] = useState(() => localStorage.getItem(RAIL_KEY) === "1");
  const canWide = layout === "wide";
  const wide = canWide && !compact;
  const toggle = () => {
    localStorage.setItem(RAIL_KEY, compact ? "0" : "1");
    setCompact(!compact);
  };
  return (
    <m.nav
      aria-label="主导航"
      initial={false}
      animate={{ width: wide ? WIDE_PX : COMPACT_PX }}
      transition={SPRING}
      className={`rail relative z-10 flex shrink-0 flex-col overflow-hidden py-3 ${wide ? "px-3" : "items-center px-2.5"}`}
    >
      <Brand wide={wide} />
      <SearchButton wide={wide} onSearch={onSearch} />
      {wide && <p className="rail-label mt-5 mb-2 px-1.5">工作台</p>}
      <LayoutGroup id="rail">
        <ul className={`flex flex-col ${wide ? "gap-0.5" : "mt-4 items-center gap-1.5"}`}>
          {NAV.map((n) => (
            <NavRow key={n.area} n={n} on={n.area === area} wide={wide} c={counts[n.area]} />
          ))}
        </ul>
      </LayoutGroup>
      {wide && (
        <div className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3 [scrollbar-width:none]">
          <LiveCard />
          <Recent />
        </div>
      )}
      <div className="mt-auto flex w-full flex-col gap-2 pt-3">
        {canWide && (
          <button
            type="button"
            onClick={toggle}
            title={compact ? "展开侧栏" : "收起侧栏"}
            aria-label={compact ? "展开侧栏" : "收起侧栏"}
            className={`flex h-8 items-center gap-2 rounded-lg text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground [&_svg]:size-4 ${wide ? "px-2" : "w-full justify-center"}`}
          >
            {compact ? <PanelLeftOpen /> : <PanelLeftClose />}
            {wide && "收起侧栏"}
          </button>
        )}
        <Me wide={wide} />
      </div>
    </m.nav>
  );
}

function NavRow({ n, on, wide, c }: { n: NavItem; on: boolean; wide: boolean; c?: Counts[AreaId] }) {
  const [hover, setHover] = useState(false);
  const tile = { "--tile": n.tone } as CSSProperties;
  return (
    <li className="relative" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {hover && !on && <m.span layoutId="rail-hover" className="rail-hover absolute inset-0 rounded-xl" transition={SPRING} />}
      {on && <m.span layoutId="rail-active" className="rail-active absolute inset-0 rounded-xl" style={tile} transition={SPRING} />}
      <a
        href={link(n.area)}
        aria-current={on ? "page" : undefined}
        aria-label={n.label}
        title={wide ? undefined : `${n.label} (Alt+${n.key})`}
        className={`group relative flex items-center rounded-xl ${wide ? "h-11 gap-3 px-2" : "size-11 justify-center"}`}
      >
        <IconTile tone={n.tone} active={on}>
          {n.icon}
        </IconTile>
        {wide && (
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className={`truncate text-[13.5px] ${on ? "font-semibold text-foreground" : "font-medium text-sidebar-foreground/85 group-hover:text-foreground"}`}>{n.label}</span>
            <span className="truncate text-[11px] text-muted-foreground">{n.hint}</span>
          </span>
        )}
        {wide && !c && <kbd className="num hidden rounded border border-sidebar-border px-1 text-[10px] text-muted-foreground group-hover:inline">Alt {n.key}</kbd>}
        {wide && <CountBadge c={c} />}
        {!wide && c && (
          <span className="absolute top-0.5 right-0.5">
            <CountBadge c={c} compact />
          </span>
        )}
      </a>
    </li>
  );
}

// 手机底栏: 选中项上方一道光条随选中项滑动, 计数角标与侧栏同源
export function BottomNav({ area }: { area: AreaId }) {
  const counts = useNavCounts();
  return (
    <nav aria-label="主导航" className="safe-bottom rail flex border-t border-sidebar-border">
      <LayoutGroup id="bottom">
        {NAV.map((n) => {
          const on = n.area === area;
          const c = counts[n.area];
          return (
            <a key={n.area} href={link(n.area)} aria-current={on ? "page" : undefined} className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] ${on ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              {on && <m.span layoutId="bottom-active" className="absolute top-0 h-[3px] w-8 rounded-b-full" style={{ background: n.tone, boxShadow: `0 0 12px ${n.tone}` }} transition={SPRING} />}
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
      </LayoutGroup>
    </nav>
  );
}
