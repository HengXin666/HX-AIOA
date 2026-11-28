import { FIELD_CPU, FIELD_MEM, type HostCard } from "@hx-aioa/protocol";
import { Sparkline } from "@hx/ui/data";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Progress } from "@hx/ui/ui/progress";
import { ChevronRight, Server } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { useResources, useVisible } from "../../app/hooks";
import { href, link } from "../../app/router";
import { resources } from "../../core/resources";
import { Panel, Quiet, TONE } from "./parts";

const SHOWN = 3;
const TREND = 30;
const TONES = [TONE.accent, TONE.success, TONE.warning];

// 资源 (对照安卓 OverviewV2.Hosts): 每台主机一块, 负载条 + CPU 走势; 只在总览看得见时 watch 前几台
export function Hosts({ className }: { className?: string }) {
  const { probes, hosts } = useResources();
  const visible = useVisible();
  const on = new Set(probes);
  const list = [...hosts].sort((a, b) => Number(on.has(b.subject) || b.online) - Number(on.has(a.subject) || a.online)).slice(0, SHOWN);
  const key = list.map((h) => h.subject).join("\n");
  useEffect(() => {
    resources.watch(visible ? list.map((h) => h.subject) : []);
    return () => resources.watch([]);
  }, [key, visible]);
  return (
    <Panel
      title="资源"
      icon={<Server />}
      count={hosts.filter((h) => on.has(h.subject) || h.online).length}
      hint="在线主机"
      className={className}
      action={
        <Button asChild size="xs" variant="ghost">
          <a href={link("res")}>
            全部
            <ChevronRight />
          </a>
        </Button>
      }
    >
      {list.length ? list.map((h, i) => <Host key={h.subject} h={h} online={on.has(h.subject) || h.online} tone={TONES[i % TONES.length]!} />) : <Quiet icon={<Server />}>还没有探针, 在资源栏添加</Quiet>}
    </Panel>
  );
}

function Host({ h, online, tone }: { h: HostCard; online: boolean; tone: string }) {
  const buf = resources.buffer(h.subject);
  useSyncExternalStore((fn) => buf.changed.on(fn), () => buf.ts.length);
  const cpuSeries = buf.values(FIELD_CPU).filter(Number.isFinite).slice(-TREND);
  const cpu = cpuSeries.at(-1) ?? h.last?.values?.[FIELD_CPU];
  const mem = buf.values(FIELD_MEM).filter(Number.isFinite).at(-1) ?? h.last?.values?.[FIELD_MEM];
  return (
    <a href={href({ name: "res", tab: "hosts", id: h.subject })} className="flex flex-col gap-2 rounded-lg border border-border p-3 transition-colors hover:border-ring/50">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{h.info.hostname ?? h.subject}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{h.info.os}</span>
        <Badge variant="outline" dot={online ? "success" : "muted"}>
          {online ? "在线" : "离线"}
        </Badge>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Load label="CPU" pct={cpu} />
          <Load label="内存" pct={mem} />
        </div>
        {cpuSeries.length >= 2 && (
          <div className="w-24">
            <Sparkline values={cpuSeries} color={tone} height={40} />
          </div>
        )}
      </div>
    </a>
  );
}

function Load({ label, pct }: { label: string; pct?: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-8 text-muted-foreground">{label}</span>
      <Progress className="flex-1" value={pct ?? 0} />
      <span className="w-9 text-right font-medium text-foreground tabular-nums">{pct === undefined ? "-" : `${Math.round(pct)}%`}</span>
    </div>
  );
}
