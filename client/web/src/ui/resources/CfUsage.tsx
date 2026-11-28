import { Card } from "@hx/ui/ui/card";
import { PATH_CF_USAGE } from "@hx-aioa/protocol";
import { api } from "../../core/auth";
import { TXT_LOADING, LOCALE } from "../../core/constants";
import { shortTime } from "../ChatList";
import { sizeText } from "../MessageParts";
import { useOnce } from "./useOnce";

// 与 server/src/api-cf.ts 的 CfUsage 同形 (协议包里没有, 这里只读)
type Part = { name: string; used: number };
type Item = { key: string; label: string; used: number; limit: number; unit: string; by?: Part[] };
type CfUsage = { configured: boolean; at?: number; day?: string; items?: Item[]; split?: string; storage?: { storedBytes?: number; limit: number; hubBytes?: number; error?: string } };

// 堆叠条按 worker 分色: 只用令牌色类
const PART_BG = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];
const WARN_AT = 0.8;
const num = (n: number) => n.toLocaleString(LOCALE, { maximumFractionDigits: 1 });

export function CfUsagePage() {
  const r = useOnce("cf", () => api<CfUsage>(PATH_CF_USAGE));
  const u = r.data;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
        <p className="text-xs text-muted-foreground">
          免费计划每日额度, UTC 0 点重置; 服务端缓存 10 分钟, 进页时取一次。
          {u?.at ? ` 数据时间 ${shortTime(u.at)}` : ""}
        </p>
        {r.busy && <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>}
        {r.error && <p className="text-sm text-destructive">{r.error}</p>}
        {u && !u.configured && <p className="text-sm text-muted-foreground">服务端没有配置 CF_API_TOKEN, 见 docs/deploy/cf-usage.md。</p>}
        {u?.items?.map((it) => <Quota key={it.key} it={it} />)}
        {u?.split && <p className="text-xs text-muted-foreground">按 worker 拆分失败: {u.split}</p>}
        {u?.storage && (
          <Card className="flex flex-col gap-2 p-3">
            <h3 className="text-sm font-medium text-foreground">存储 (不按天重置)</h3>
            <Bar used={u.storage.storedBytes ?? 0} limit={u.storage.limit} parts={[]} />
            <p className="text-xs text-muted-foreground">
              DO 存储 {sizeText(u.storage.storedBytes ?? 0)} / {sizeText(u.storage.limit)}
              {u.storage.hubBytes !== undefined ? ` · 主库 ${sizeText(u.storage.hubBytes)}` : ""}
              {u.storage.error ? ` · ${u.storage.error}` : ""}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Quota({ it }: { it: Item }) {
  const frac = it.limit ? it.used / it.limit : 0;
  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{it.label}</h3>
        <span className={`text-sm tabular-nums ${frac >= WARN_AT ? "text-destructive" : "text-muted-foreground"}`}>
          {num(it.used)} / {num(it.limit)} {it.unit} · {(frac * 100).toFixed(1)}%
        </span>
      </div>
      <Bar used={it.used} limit={it.limit} parts={it.by ?? []} />
      {it.by && it.by.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {it.by.map((p, i) => (
            <li key={p.name} className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${PART_BG[i % PART_BG.length]}`} />
              {p.name} {num(p.used)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Bar({ used, limit, parts }: { used: number; limit: number; parts: Part[] }) {
  const pct = (n: number) => `${Math.min(100, limit ? (n / limit) * 100 : 0)}%`;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={used} aria-valuemax={limit}>
      {parts.length > 1 ? parts.map((p, i) => <div key={p.name} className={PART_BG[i % PART_BG.length]} style={{ width: pct(p.used) }} />) : <div className="bg-chart-1" style={{ width: pct(used) }} />}
    </div>
  );
}
