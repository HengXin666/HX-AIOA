import { PATH_CF_STORAGE, PATH_CF_USAGE, PATH_CF_ZONES, type HostCard } from "@hx-aioa/protocol";
import { AreaTrend, Bullet, Donut } from "@hx/ui/data";
import { Badge } from "@hx/ui/ui/badge";
import { Skeleton } from "@hx/ui/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { Cloud, Database, Globe, HeartPulse } from "lucide-react";
import { useState } from "react";
import { useResources } from "../../app/hooks";
import { href } from "../../app/router";
import { api } from "../../core/auth";
import { LOCALE } from "../../core/constants";
import { shortTime } from "../ChatList";
import { sizeText } from "../MessageParts";
import { useOnce, type Loaded } from "../resources/useOnce";
import { Panel, Quiet, TONE } from "./parts";

// 与 server/src/api-cf*.ts 同形 (协议包里没有, 这里只读)
type Quota = { key: string; label: string; used: number; limit: number; unit: string; by?: { name: string; used: number }[] };
type CfUsage = { configured: boolean; at?: number; items?: Quota[]; storage?: { storedBytes?: number; limit: number; hubBytes?: number } };
type CfStore = { kind: "r2" | "kv" | "d1"; id: string; name: string; bytes: number; objects?: number };
type CfStorage = { configured: boolean; at?: number; quotas?: (Quota & { period: string })[]; stores?: CfStore[]; errors?: string[] };
type CfPoint = { t: string; req: number; cached: number; threats: number; bytes: number };
type CfZone = { id: string; name: string; plan?: string; req: number; cached: number; bytes: number; threats: number; series: CfPoint[]; hosts: { host: string; req: number }[]; workerReq?: number };
type CfZones = { configured: boolean; at?: number; zones?: CfZone[]; workerDayLimit?: number };

const BEAT = { g: TONE.success, y: TONE.warning, r: TONE.danger, n: "var(--muted)" } as Record<string, string>;
const num = (n: number) => n.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
const fmt = (unit: string) => (v: number) => (unit === "B" ? sizeText(v) : num(v));

// "服务器" 看板 (对照安卓 Boards.ServerBoard + Heartbeat + CF 页): 设备心跳, CF 每日额度, 存储与流量
export function ServerBoard() {
  // 额度与 DO 存储同一个接口, 两块卡片共用一次请求
  const usage = useOnce("cf-usage", () => api<CfUsage>(PATH_CF_USAGE));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Devices />
      <Usage r={usage} />
      <Storage u={usage.data} />
      <Zones />
    </div>
  );
}

function Devices() {
  const { probes, hosts } = useResources();
  const on = new Set(probes);
  return (
    <Panel title="设备心跳" icon={<HeartPulse />} count={hosts.length} hint="绿正常, 黄延迟大, 红失联" className="lg:col-span-12">
      {!hosts.length && <Quiet icon={<HeartPulse />}>还没有探针</Quiet>}
      {hosts.map((h) => (
        <Device key={h.subject} h={h} online={on.has(h.subject) || h.online} />
      ))}
    </Panel>
  );
}

function Device({ h, online }: { h: HostCard; online: boolean }) {
  const beats = h.beats ?? "";
  const lost = [...beats].filter((c) => c === "r").length;
  return (
    <a href={href({ name: "res", tab: "hosts", id: h.subject })} className="flex flex-col gap-1.5 rounded-lg px-2 py-2 hover:bg-muted">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-foreground">{h.info.hostname ?? h.subject}</span>
        <Badge variant="outline" dot={online ? "success" : "muted"}>
          {online ? "在线" : `离线 · ${shortTime(h.seen)}`}
        </Badge>
        {h.avail !== undefined && <span className="ml-auto text-xs text-muted-foreground tabular-nums">可用率 {h.avail.toFixed(2)}%</span>}
      </div>
      {beats ? (
        <div className="flex h-6 gap-px" title={lost ? `${lost} 格失联` : "一直正常"}>
          {[...beats].map((c, i) => (
            <span key={i} className="flex-1 rounded-[2px]" style={{ background: BEAT[c] ?? BEAT.n }} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">没有心跳数据</p>
      )}
    </a>
  );
}

function Usage({ r }: { r: Loaded<CfUsage> }) {
  const u = r.data;
  return (
    <Panel title="CF 每日额度" icon={<Cloud />} hint={u?.at ? `UTC 0 点重置 · ${shortTime(u.at)}` : "UTC 0 点重置"} className="lg:col-span-7">
      {!u && !r.error && <Skeleton className="h-40 w-full" />}
      {r.error && <Quiet icon={<Cloud />}>{r.error}</Quiet>}
      {u && !u.configured && <Quiet icon={<Cloud />}>服务端没有配置 CF 读取令牌</Quiet>}
      {u?.items && (
        <Bullet
          size="sm"
          statusColor
          items={u.items.map((it) => ({ label: it.label, sub: it.unit, value: it.used, target: it.limit, max: it.limit, ranges: [it.limit * 0.6, it.limit * 0.8], better: "lower" as const, format: num }))}
          rangeLabels={["宽裕", "注意", "紧张"]}
        />
      )}
    </Panel>
  );
}

function Storage({ u }: { u: CfUsage | null }) {
  const r = useOnce("cf-storage", () => api<CfStorage>(PATH_CF_STORAGE));
  const s = r.data;
  const stores = [...(s?.stores ?? [])].sort((a, b) => b.bytes - a.bytes).slice(0, 6);
  return (
    <Panel title="存储" icon={<Database />} hint={s?.errors?.length ? s.errors[0] : "R2 / KV / D1"} className="lg:col-span-5">
      {!s && !r.error && <Skeleton className="h-40 w-full" />}
      {r.error && <Quiet icon={<Database />}>{r.error}</Quiet>}
      {stores.length > 0 && (
        <Donut data={stores.map((x) => ({ key: x.id, label: `${x.kind.toUpperCase()} ${x.name}`, value: x.bytes }))} center={sizeText(stores.reduce((n, x) => n + x.bytes, 0))} centerLabel="已用" size={210} />
      )}
      {u?.storage && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">DO 存储 (主 Hub {u.storage.hubBytes ? sizeText(u.storage.hubBytes) : "-"})</span>
          <span className="text-foreground tabular-nums">
            {sizeText(u.storage.storedBytes ?? 0)} / {sizeText(u.storage.limit)}
          </span>
        </div>
      )}
      {s?.quotas?.slice(0, 4).map((q) => (
        <div key={q.key} className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {q.label} ({q.period})
          </span>
          <span className="text-foreground tabular-nums">
            {fmt(q.unit)(q.used)} / {fmt(q.unit)(q.limit)}
          </span>
        </div>
      ))}
    </Panel>
  );
}

function Zones() {
  const [range, setRange] = useState<"1d" | "7d">("1d");
  const r = useOnce(`cf-zones-${range}`, () => api<CfZones>(`${PATH_CF_ZONES}?range=${range}`));
  const zones = r.data?.zones ?? [];
  return (
    <Panel
      title="站点流量"
      icon={<Globe />}
      count={zones.length}
      hint={r.data?.workerDayLimit ? `Worker 每日额度 ${num(r.data.workerDayLimit)} 次` : undefined}
      className="lg:col-span-12"
      action={
        <ToggleGroup type="single" size="sm" variant="outline" value={range} onValueChange={(v) => v && setRange(v as "1d" | "7d")}>
          <ToggleGroupItem value="1d">24 小时</ToggleGroupItem>
          <ToggleGroupItem value="7d">7 天</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {!r.data && !r.error && <Skeleton className="h-48 w-full" />}
      {r.error && <Quiet icon={<Globe />}>{r.error}</Quiet>}
      <div className="grid gap-4 md:grid-cols-2">
        {zones.map((z) => (
          <div key={z.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-foreground">{z.name}</span>
              <span className="text-xs text-muted-foreground">
                {num(z.req)} 请求 · 缓存 {z.req ? Math.round((z.cached / z.req) * 100) : 0}% · {sizeText(z.bytes)}
              </span>
            </div>
            <AreaTrend data={z.series.map((p) => ({ t: p.t.slice(range === "1d" ? 11 : 5, range === "1d" ? 16 : 10), req: p.req, cached: p.cached }))} x="t" series={[{ key: "req", label: "请求", color: TONE.primary }, { key: "cached", label: "命中缓存", color: TONE.success }]} height={140} />
            <div className="flex flex-wrap gap-1">
              {z.hosts.slice(0, 4).map((h) => (
                <Badge key={h.host} variant="secondary">
                  {h.host} {num(h.req)}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
