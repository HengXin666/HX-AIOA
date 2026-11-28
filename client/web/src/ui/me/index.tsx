import { Bell, ChevronRight, Database, HardDrive, Info, Keyboard, Palette, UserRound, Users } from "lucide-react";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { useLinkState, useMyFace, useUser } from "../../app/hooks";
import { link, nav } from "../../app/router";
import { EmptyState, PageHeader, TwoPane } from "../kit/Panes";
import type { AreaProps } from "../Shell";
import { UserAvatar } from "../UserAvatar";

type Page = { id: string; label: string; icon: ReactNode; group: string; admin?: boolean; owner?: boolean; load: ComponentType<{ owner: boolean }> };
// 对照安卓 "我的" (docs/client/settings-map.md): 代理, 保活, 系统权限, APK 更新在 Web 端去掉
const PAGES: Page[] = [
  { id: "account", label: "账号", icon: <UserRound />, group: "账号", load: lazy(() => import("./Account")) },
  { id: "notify", label: "通知", icon: <Bell />, group: "常用", load: lazy(() => import("./Notify")) },
  { id: "look", label: "外观", icon: <Palette />, group: "常用", load: lazy(() => import("./Look")) },
  { id: "sources", label: "数据源与接入", icon: <Database />, group: "数据", owner: true, load: lazy(() => import("./Sources")) },
  { id: "storage", label: "存储", icon: <HardDrive />, group: "数据", load: lazy(() => import("./Storage")) },
  { id: "members", label: "成员与邀请", icon: <Users />, group: "管理", admin: true, load: lazy(() => import("./Members")) },
  { id: "keys", label: "快捷键", icon: <Keyboard />, group: "系统", load: lazy(() => import("./About").then((m) => ({ default: m.Keys }))) },
  { id: "about", label: "关于", icon: <Info />, group: "系统", load: lazy(() => import("./About")) },
];

// 我的栏: 左列表右详情 (#/me/<页>); 手机进子页
export default function MeArea({ loc, layout }: AreaProps) {
  const user = useUser();
  const face = useMyFace();
  const admin = user?.role === "owner" || user?.role === "admin";
  const owner = user?.role === "owner";
  const pages = PAGES.filter((p) => (!p.admin || admin) && (!p.owner || owner));
  const current = pages.find((p) => p.id === loc.path[0]) ?? (layout === "narrow" ? null : pages[0]!);
  const groups = [...new Set(pages.map((p) => p.group))];

  const list = (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title="我的" />
      <a href={link("me", "account")} className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:bg-muted">
        <UserAvatar id={face} name={user?.display ?? ""} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{user?.display}</span>
          <span className="block truncate text-xs text-muted-foreground">
            @{user?.name} · <LinkText />
          </span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </a>
      {groups.map((g) => (
        <section key={g} className="px-3 pt-4">
          <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g}</h3>
          <ul className="flex flex-col">
            {pages
              .filter((p) => p.group === g)
              .map((p) => (
                <li key={p.id}>
                  <a href={link("me", p.id)} className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm [&_svg]:size-4 ${current?.id === p.id ? "bg-accent text-foreground" : "text-foreground hover:bg-muted"}`}>
                    {p.icon}
                    <span className="flex-1">{p.label}</span>
                    {layout === "narrow" && <ChevronRight className="text-muted-foreground" />}
                  </a>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );

  const Page = current?.load;
  const detail = current && Page ? (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={current.label} back={layout === "narrow" ? () => nav("me") : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3 pb-6">
          <Suspense fallback={null}>
            <Page owner={owner} />
          </Suspense>
        </div>
      </div>
    </div>
  ) : (
    <EmptyState>选一项</EmptyState>
  );
  return <TwoPane layout={layout} showDetail={Boolean(loc.path[0])} list={list} detail={detail} listWidth={300} />;
}

const LINK_TEXT = { idle: "未连接", connecting: "连接中", online: "已连接", offline: "重连中" } as const;
function LinkText() {
  return <>{LINK_TEXT[useLinkState()]}</>;
}
