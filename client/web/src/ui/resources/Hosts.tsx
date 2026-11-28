import type { HostCard } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useResources, useVisible, type Layout } from "../../app/hooks";
import { go, href } from "../../app/router";
import { LIVE_WINDOW_MS, LOCALE } from "../../core/constants";
import { nameOf, resources, unitOf } from "../../core/resources";
import { Ring } from "../../charts/svg";
import { TimeSeries } from "../../charts/TimeSeries";
import type { SeriesDef } from "../../charts/timechart";
import { shortTime } from "../ChatList";
import { sizeText } from "../MessageParts";

type Row = { subject: string; online: boolean; card?: HostCard };
const PERCENT = "%";

function rows(probes: string[], hosts: HostCard[]): Row[] {
  const on = new Set(probes);
  const map = new Map<string, Row>(hosts.map((h) => [h.subject, { subject: h.subject, online: on.has(h.subject) || h.online, card: h }]));
  for (const s of probes) if (!map.has(s)) map.set(s, { subject: s, online: true });
  return [...map.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.subject.localeCompare(b.subject));
}

export function HostsPage({ subject, layout }: { subject?: string; layout: Layout }) {
  const { probes, hosts } = useResources();
  const list = useMemo(() => rows(probes, hosts), [probes, hosts]);
  const row = subject ? list.find((r) => r.subject === subject) : undefined;
  if (layout === "narrow") return subject ? <Detail subject={subject} row={row} back /> : <HostList rows={list} active={undefined} />;
  return (
    <div className="flex h-full min-h-0">
      <div className="w-[300px] shrink-0 border-r border-border">
        <HostList rows={list} active={subject} />
      </div>
      <div className="min-w-0 flex-1">{subject ? <Detail key={subject} subject={subject} row={row} /> : <Pick />}</div>
    </div>
  );
}

function Pick() {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选一台主机看实时指标</div>;
}

function HostList({ rows, active }: { rows: Row[]; active?: string }) {
  if (!rows.length) return <p className="p-6 text-center text-sm text-muted-foreground">还没有探针。在安卓 App 的 "资源" 里添加。</p>;
  return (
    <ul className="flex h-full flex-col gap-1 overflow-y-auto p-2">
      {rows.map((r) => {
        const v = r.card?.last?.values ?? {};
        return (
          <li key={r.subject}>
            <a href={href({ name: "res", tab: "hosts", id: r.subject })} className={`flex items-center gap-3 rounded-lg p-2 ${r.subject === active ? "bg-accent" : "hover:bg-muted"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{r.subject}</span>
                  <Badge variant="outline" dot={r.online ? "success" : "muted"}>
                    {r.online ? "在线" : "离线"}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[r.card?.info.hostname, r.card?.info.os].filter(Boolean).join(" · ") || (r.card && !r.online ? `${shortTime(r.card.seen)} 最后在线` : " ")}
                </p>
              </div>
              {v.cpu !== undefined && <Ring value={v.cpu} label={`CPU ${v.cpu}%`} size={36} />}
              {v.mem !== undefined && <Ring value={v.mem} color={1} label={`内存 ${v.mem}%`} size={36} />}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// 看得见才 watch: 离开, 切走标签, 最小化都立即退订, 探针随之停推
function useWatch(subject: string): void {
  const visible = useVisible();
  useEffect(() => {
    resources.watch(visible ? [subject] : []);
  }, [subject, visible]);
  useEffect(() => () => resources.watch([]), []);
}

// 字段集合只在出现新字段时变, 不随每个点重渲染
function useFields(subject: string): string[] {
  const buf = resources.buffer(subject);
  const [fields, setFields] = useState(() => buf.fields());
  useEffect(() => {
    setFields(buf.fields());
    return buf.changed.on(() => setFields((old) => (old.length === buf.fields().length ? old : buf.fields())));
  }, [buf]);
  return fields;
}

function Detail({ subject, row, back }: { subject: string; row?: Row; back?: boolean }) {
  useWatch(subject);
  const fields = useFields(subject);
  const groups = useMemo(() => {
    const by = new Map<string, SeriesDef[]>();
    fields.forEach((f, i) => {
      const u = unitOf(f);
      by.set(u, [...(by.get(u) ?? []), { key: f, label: nameOf(f), color: i }]);
    });
    return [...by.entries()].sort(([a], [b]) => Number(b === PERCENT) - Number(a === PERCENT));
  }, [fields]);
  const info = row?.card?.info;
  const buf = resources.buffer(subject);
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-center gap-2">
          {back && (
            <Button size="icon-sm" variant="ghost" aria-label="返回" onClick={() => go({ name: "res", tab: "hosts" })}>
              <ArrowLeft />
            </Button>
          )}
          <h3 className="text-base font-semibold text-foreground">{subject}</h3>
          <Badge variant="outline" dot={row?.online ? "success" : "muted"} live={row?.online}>
            {row?.online ? "实时" : "离线"}
          </Badge>
        </header>
        {info && (
          <dl className="grid gap-x-4 gap-y-1 text-sm [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
            {info.hostname && <Info k="主机名" v={info.hostname} />}
            {info.os && <Info k="系统" v={`${info.os}${info.arch ? ` (${info.arch})` : ""}`} />}
            {!!info.cores && <Info k="核数" v={String(info.cores)} />}
            {!!info.memTotal && <Info k="内存" v={sizeText(info.memTotal)} />}
            {!!info.diskTotal && <Info k="磁盘" v={sizeText(info.diskTotal)} />}
            {info.ip && <Info k="IP" v={info.ip} />}
            {!!info.bootAt && <Info k="开机" v={new Date(info.bootAt).toLocaleString(LOCALE)} />}
            {row?.card?.avail !== undefined && <Info k="可用率" v={`${row.card.avail.toFixed(2)}%`} />}
          </dl>
        )}
        {!groups.length && <p className="text-sm text-muted-foreground">{row?.online ? "等探针推送指标" : "探针离线, 没有实时数据"}</p>}
        {groups.map(([unit, defs]) => (
          <section key={unit || "-"} className="rounded-xl border border-border bg-card p-3">
            <h4 className="mb-1 text-sm font-medium text-foreground">
              {defs.map((d) => d.label).join(" / ")}
              {unit && <span className="ml-1 text-xs text-muted-foreground">({unit})</span>}
            </h4>
            <TimeSeries source={buf} series={defs} unit={unit} windowMs={LIVE_WINDOW_MS} yMax={unit === PERCENT ? 100 : undefined} />
          </section>
        ))}
      </div>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="truncate text-foreground">{v}</dd>
    </div>
  );
}
