import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { ArrowRightLeft, Brain, FilePen, FileText, Globe, Search, SquareTerminal, Trash2, Wrench } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { link } from "../../../app/router";
import { ROUTE_LABEL, STATE_DOT, STATE_LABEL, STORAGE_AG_MODE, TXT_RECONNECT } from "../../../agentgui/constants";
import type { ConnState } from "../../../agentgui/conn";
import type { Route } from "../../../agentgui/types";

export const GUI = "gui";
export const INBOX = "inbox";
export const SETTINGS = "settings";
export const guiLink = (...path: string[]): string => link("agent", GUI, ...path);
export const sessionLink = (host: string, sid: string): string => guiLink(host, sid);

export type GuiMode = "work" | "approve";
export const guiMode = (): GuiMode => (localStorage.getItem(STORAGE_AG_MODE) === "approve" ? "approve" : "work");

// 工作 | 审批 切换, 记在本机
export function ModeToggle({ mode }: { mode: GuiMode }) {
  const pick = (v: string) => {
    if (v !== "work" && v !== "approve") return;
    localStorage.setItem(STORAGE_AG_MODE, v);
    location.hash = v === "approve" ? guiLink(INBOX) : guiLink();
  };
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={pick} aria-label="工作或审批">
      <ToggleGroupItem value="work">工作</ToggleGroupItem>
      <ToggleGroupItem value="approve">审批</ToggleGroupItem>
    </ToggleGroup>
  );
}

const DOT_CLASS: Record<string, string> = { info: "bg-info", warning: "bg-warning", success: "bg-success", destructive: "bg-destructive", muted: "bg-muted-foreground/50" };

export function StateDot({ state, className = "" }: { state: string; className?: string }) {
  const dot = STATE_DOT[state] ?? "muted";
  return <span role="img" aria-label={STATE_LABEL[state] ?? state} className={`inline-block size-2 shrink-0 rounded-full ${DOT_CLASS[dot]} ${state === "running" ? "animate-pulse" : ""} ${className}`} />;
}

export function RouteBadge({ route, state }: { route: Route | null; state: ConnState }) {
  if (state === "ready" && route) return <Badge variant="outline" dot="success">{ROUTE_LABEL[route.kind] ?? route.kind}</Badge>;
  if (state === "connecting" || state === "retry") return <Badge variant="outline" dot="warning">连接中</Badge>;
  if (state === "unpaired") return <Badge variant="outline" dot="muted">未配对</Badge>;
  if (state === "noroute") return <Badge variant="outline" dot="muted">无直连</Badge>;
  if (state === "unreachable") return <Badge variant="outline" dot="warning">只能审批</Badge>;
  return <Badge variant="outline" dot="destructive">不可用</Badge>;
}

// 这台设备连不上主机: 说清楚只能审批, 引导到收件箱
export function ApproveOnly({ text, n, onRetry }: { text: string; n?: number; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm text-muted-foreground">{text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" asChild>
          <a href={guiLink(INBOX)} onClick={() => localStorage.setItem(STORAGE_AG_MODE, "approve")}>
            去收件箱{n ? ` 处理 ${n} 个请求` : ""}
          </a>
        </Button>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            再试直连
          </Button>
        )}
      </div>
    </div>
  );
}

// 断线时顶部细条; 内容保持可读
export function ReconnectBar({ state }: { state: ConnState }) {
  if (state !== "retry" && state !== "connecting") return null;
  return (
    <div role="status" className="relative h-6 shrink-0 overflow-hidden border-b border-border bg-muted text-center text-xs leading-6 text-muted-foreground">
      <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse bg-warning/20" />
      {TXT_RECONNECT}
    </div>
  );
}

const ICONS: Record<string, ReactNode> = {
  read: <FileText />,
  edit: <FilePen />,
  delete: <Trash2 />,
  move: <ArrowRightLeft />,
  search: <Search />,
  execute: <SquareTerminal />,
  think: <Brain />,
  fetch: <Globe />,
};
export const KindIcon = ({ kind }: { kind: string }) => <>{ICONS[kind] ?? <Wrench />}</>;

export const basename = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时`;
  return `${Math.floor(s / 86400)} 天`;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

// 每秒刷新一次的 "现在", 给 "等了多久" 用
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export const kTok = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

export function AgentGlyph({ name }: { name: string }) {
  return (
    <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground uppercase">
      {name.slice(0, 1)}
    </span>
  );
}
