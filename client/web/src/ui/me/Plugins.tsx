import { Badge } from "@hx/ui/ui/badge";
import { Card } from "@hx/ui/ui/card";
import { Skeleton } from "@hx/ui/ui/skeleton";
import { Switch } from "@hx/ui/ui/switch";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import * as plugins from "../../core/plugins";
import type { PluginItem } from "../../core/plugins";
import { Detail } from "./plugins/Detail";
import { FitBadge, PluginIcon, stateOf } from "./plugins/parts";
import { errText, Group } from "./parts";

// 插件 (#167, 对照安卓 settings/PluginsPage): 市场列表按 开发中 / 已安装 / 官方 / 第三方 分组, 点开进详情
export default function Plugins() {
  const [open, setOpen] = useState<string | null>(null);
  const [market, setMarket] = useState<Awaited<
    ReturnType<typeof plugins.list>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dev, setDev] = useState<boolean | null>(null);
  const [rev, bump] = plugins.usePluginRev();
  useEffect(() => {
    plugins.list().then(
      (m) => {
        setMarket(m);
        setError(m.error ?? null);
        if (m.admin)
          void plugins.devMode().then(
            (d) => setDev(d.on),
            () => undefined,
          );
      },
      (e) => setError(errText(e)),
    );
  }, [rev]);
  if (open)
    return <Detail id={open} onBack={() => setOpen(null)} onChanged={bump} />;

  const items = market?.plugins ?? [];
  const devs = items.filter((p) => p.dev);
  const rest = items.filter((p) => !p.dev);
  const mine = rest.filter(plugins.mine);
  const others = rest.filter((p) => !plugins.mine(p));
  const official = others.filter((p) => !sourceOf(p));
  const third = new Map<string, PluginItem[]>();
  for (const p of others) {
    const s = sourceOf(p);
    if (s) third.set(s, [...(third.get(s) ?? []), p]);
  }
  return (
    <>
      <p className="px-1 text-sm text-muted-foreground">
        插件把一种玩法打包分发: 一个群, 一个群 Agent (提示词), 一个工作台面板,
        数据归启用它的账号。不在浏览器里运行代码, 群 Agent 由你自己机器上的
        agent harness 或云端来跑。
      </p>
      {error && <p className="px-1 text-sm text-destructive">{error}</p>}
      {!market && !error && <Skeleton className="h-40 w-full rounded-xl" />}
      {market && !items.length && !error && (
        <p className="px-1 text-sm text-muted-foreground">市场里还没有插件。</p>
      )}
      <List title="开发中" list={devs} onOpen={setOpen} />
      <List
        title={market?.owner === false ? "已启用" : "已安装"}
        list={mine}
        onOpen={setOpen}
      />
      <List title="官方市场" list={official} onOpen={setOpen} />
      {[...third].map(([name, list]) => (
        <List
          key={name}
          title={`第三方: ${name}`}
          list={list}
          onOpen={setOpen}
        />
      ))}
      {dev !== null && (
        <Group title="开发模式">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              开发模式
              <span className="block text-xs text-muted-foreground">
                只在你自己的账号上试本地插件, 别人看不到。用
                tools/plugin-dev.mjs 把插件目录传上来; 关掉时开发插件全部撤掉。
              </span>
            </span>
            <Switch
              checked={dev}
              onCheckedChange={(on) =>
                void plugins.setDevMode(on).then(
                  () => (setDev(on), bump()),
                  (e) => toast.error(errText(e)),
                )
              }
            />
          </label>
        </Group>
      )}
    </>
  );
}

// 第三方市场源的名字; 官方源为空
const sourceOf = (p: PluginItem) =>
  (p as PluginItem & { sourceName?: string }).sourceName ?? p.allowed?.source;

function List({
  title,
  list,
  onOpen,
}: {
  title: string;
  list: PluginItem[];
  onOpen: (id: string) => void;
}) {
  if (!list.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <Card className="gap-0 overflow-hidden p-0">
        {list.map((p, i) => (
          <Tile key={p.id} p={p} i={i} onOpen={() => onOpen(p.id)} />
        ))}
      </Card>
    </section>
  );
}

function Tile({
  p,
  i,
  onOpen,
}: {
  p: PluginItem;
  i: number;
  onOpen: () => void;
}) {
  const s = stateOf(p);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/50"
    >
      <PluginIcon name={p.icon || "puzzle"} i={i} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{p.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            v{p.installed?.version ?? p.version}
          </span>
        </span>
        <span className="line-clamp-1 text-xs text-muted-foreground">
          {p.summary}
        </span>
        {p.tags?.length ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {p.tags.map((t) => `#${t}`).join(" ")}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {s && (
          <Badge variant="outline" dot={s.dot}>
            {s.text}
          </Badge>
        )}
        <FitBadge fit={p.client} />
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
