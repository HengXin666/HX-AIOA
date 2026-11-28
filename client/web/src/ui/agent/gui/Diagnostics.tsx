import { Button } from "@hx/ui/ui/button";
import { Switch } from "@hx/ui/ui/switch";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { diag, summarize, useDiag, type DiagEvent } from "../../../agentgui/diag";
import { notifyOn, setNotify } from "../../../agentgui/notify";
import { allPairs } from "../../../agentgui/pairs";
import { ROUTE_LABEL } from "../../../agentgui/constants";
import { Section } from "./Settings";

const KIND: Record<DiagEvent["kind"], string> = { route: "试路线", ready: "连上", drop: "断开", hx: "请求", acp: "ACP", error: "错误" };
const ms = (v?: number) => (v === undefined ? "-" : `${v} ms`);
const RECENT = 40;

// 本地诊断: 替代 t3code 的遥测上报。数据只在这台设备的内存里, 导出是用户自己下载的 JSON
export function Diagnostics() {
  useDiag();
  const hosts = allPairs().map((p) => p.host);
  const recent = [...diag.events()].reverse().slice(0, RECENT);
  const save = () => {
    const url = URL.createObjectURL(new Blob([diag.export()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-gui-diag-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Section title="本地诊断" sub="连接与请求的耗时只记在这台设备的内存里, 不上报; 不含会话内容, 路径与命令">
      {hosts.length === 0 && <p className="text-sm text-muted-foreground">还没有配对的主机</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {hosts.map((h) => {
          const s = summarize(h);
          return (
            <div key={h} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium text-foreground">{h}</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                <dt>连上次数</dt>
                <dd className="text-foreground">{s.connects}</dd>
                <dt>路线失败</dt>
                <dd className="text-foreground">{s.fails}</dd>
                <dt>请求 p50 / p95</dt>
                <dd className="text-foreground">
                  {ms(s.hxP50)} / {ms(s.hxP95)}
                </dd>
                <dt>请求失败</dt>
                <dd className="text-foreground">{s.hxErr}</dd>
                <dt>下行帧</dt>
                <dd className="text-foreground">
                  {s.fps} 帧/秒 · {s.kbps} KB/秒
                </dd>
              </dl>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={save}>
          <Download />
          导出 JSON
        </Button>
        <Button size="sm" variant="ghost" onClick={() => diag.clear()}>
          <Trash2 />
          清空
        </Button>
      </div>
      {recent.length > 0 && (
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-border font-mono text-xs">
          {recent.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-2 border-b border-border px-2 py-1 last:border-0">
              <span className="shrink-0 text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
              <span className={`shrink-0 ${e.ok ? "text-success" : "text-destructive"}`}>{KIND[e.kind]}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {e.host} · {ROUTE_LABEL[e.name] ?? e.name}
                {e.note ? ` · ${e.note}` : ""}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{ms(e.ms)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// 本机通知: 页面不在前台时, 会话跑完 / 等你 / 出错弹通知
export function NotifySection() {
  const [on, setOn] = useState(notifyOn);
  const flip = (v: boolean) =>
    void setNotify(v).then((ok) => {
      setOn(ok);
      if (v && !ok) toast.error("浏览器没有给通知权限");
    });
  return (
    <Section title="本机通知" sub="页面不在前台时, 会话跑完, 等你或出错在这台设备上弹通知 (不经服务端)">
      <label className="flex items-center justify-between gap-3 text-sm text-foreground">
        会话结束时通知我
        <Switch checked={on} onCheckedChange={flip} aria-label="会话结束时通知我" />
      </label>
    </Section>
  );
}
