import { FIELD_CPU, FIELD_MEM, type HostCard } from "@hx-aioa/protocol";
import { Sparkline } from "@hx/ui/data";
import { LiveDot } from "@hx/ui/effects/live-dot";
import { Button } from "@hx/ui/ui/button";
import { m } from "motion/react";
import { ChevronRight, Server } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { useResources, useVisible } from "../../app/hooks";
import { href, link } from "../../app/router";
import { resources } from "../../core/resources";
import { Meter, Quiet, Section, TONE } from "./parts";

const SHOWN = 3;
const TREND = 30;
const TONES = ["var(--foreground)"];
const STEP_DELAY = 0.12;

// 资源 (对照安卓 OverviewV2.Hosts): 每台主机一块, 分段负载条 + CPU 走势; 只在总览看得见时 watch 前几台
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
  const online = hosts.filter((h) => on.has(h.subject) || h.online).length;
  return (
    <Section
      title="资源"
      icon={<Server />}
      tone="success"
      count={online}
      hint={hosts.length ? `${online} / ${hosts.length} 台在线` : "在线主机"}
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
      {list.length ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
          {list.map((h, i) => (
            <Host key={h.subject} h={h} online={on.has(h.subject) || h.online} tone={TONES[i % TONES.length]!} i={i} />
          ))}
        </div>
      ) : (
        <Quiet icon={<Server />}>还没有探针, 在资源栏添加</Quiet>
      )}
    </Section>
  );
}

function Host({ h, online, tone, i }: { h: HostCard; online: boolean; tone: string; i: number }) {
  const buf = resources.buffer(h.subject);
  useSyncExternalStore((fn) => buf.changed.on(fn), () => buf.ts.length);
  const cpuSeries = buf.values(FIELD_CPU).filter(Number.isFinite).slice(-TREND);
  // 推送还没到 (首屏, 离线主机) 就用主机卡片里探针的最后一次快照 (#139)
  const cpu = cpuSeries.at(-1) ?? h.last?.values?.[FIELD_CPU];
  const mem = buf.values(FIELD_MEM).filter(Number.isFinite).at(-1) ?? h.last?.values?.[FIELD_MEM];
  return (
    <m.a
      href={href({ name: "res", tab: "hosts", id: h.subject })}
      className="flex flex-col gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-center gap-2">
        <LiveDot tone={online ? "success" : "muted"} live={online} />
        <span className="truncate text-sm font-semibold text-foreground">{h.info.hostname ?? h.subject}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{h.info.os}</span>
        <span className="text-xs text-muted-foreground">{online ? "在线" : "离线"}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Load label="CPU" pct={cpu} tone={tone} delay={0.4 + i * STEP_DELAY} />
          <Load label="内存" pct={mem} tone={tone} delay={0.5 + i * STEP_DELAY} />
        </div>
        <div className="w-24 shrink-0">{cpuSeries.length >= 2 ? <Sparkline values={cpuSeries} color={tone} height={40} /> : <div className="h-10" />}</div>
      </div>
    </m.a>
  );
}

function Load({ label, pct, tone, delay }: { label: string; pct?: number; tone: string; delay: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-8 text-muted-foreground">{label}</span>
      <Meter pct={pct} color={tone} delay={delay} />
      <span className="w-9 text-right font-medium text-foreground tabular-nums">{pct === undefined ? "-" : `${Math.round(pct)}%`}</span>
    </div>
  );
}
