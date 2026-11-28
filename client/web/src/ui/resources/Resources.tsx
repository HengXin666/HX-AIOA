import { useUser, type Layout } from "../../app/hooks";
import { href, type ResTab, type Route } from "../../app/router";
import { CfUsagePage } from "./CfUsage";
import { GithubPage } from "./Github";
import { HostsPage } from "./Hosts";

const TABS: { tab: ResTab; label: string; owner?: boolean }[] = [
  { tab: "hosts", label: "主机" },
  { tab: "cf", label: "CF 额度", owner: true },
  { tab: "gh", label: "GitHub" },
];

// 资源页: 主机 / CF 额度 (只主人) / GitHub 三个分栏, 各自懒加载在这一个包里 (图表层只在这里用)
export default function Resources({ route, layout }: { route: Extract<Route, { name: "res" }>; layout: Layout }) {
  const user = useUser();
  const owner = user?.role === "owner";
  const tab = route.tab === "cf" && !owner ? "hosts" : route.tab;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1 border-b border-border px-3 py-2">
        <h2 className="mr-3 text-base font-semibold text-foreground">资源</h2>
        <nav className="flex gap-1" aria-label="资源分栏">
          {TABS.filter((t) => !t.owner || owner).map((t) => (
            <a
              key={t.tab}
              href={href({ name: "res", tab: t.tab })}
              aria-current={t.tab === tab ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${t.tab === tab ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        {tab === "hosts" && <HostsPage subject={route.id} layout={layout} />}
        {tab === "cf" && <CfUsagePage />}
        {tab === "gh" && <GithubPage repo={route.id} />}
      </div>
    </div>
  );
}
