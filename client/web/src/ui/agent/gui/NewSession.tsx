import { Button } from "@hx/ui/ui/button";
import { Input } from "@hx/ui/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hx/ui/ui/select";
import { Textarea } from "@hx/ui/ui/textarea";
import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TXT_NO_ROUTE, TXT_UNPAIRED } from "../../../agentgui/constants";
import { useConn } from "../../../agentgui/hooks";
import { allPairs } from "../../../agentgui/pairs";
import type { SessionInfo } from "../../../agentgui/types";
import { STORAGE_NEW_INSTANCE } from "./ModelPanel";
import { guiLink, SETTINGS, sessionLink } from "./parts";

export const STORAGE_NEW_CWD = "aioa.ag.newCwd";
const TITLE_MAX = 40;

function Pick({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: { value: string; name: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={label} className="max-w-56">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// 新会话页: 居中欢迎 + 吸底输入框, 上方选择条; 第一条消息发出即建会话
export function NewSession({ host, onHost }: { host: string; onHost: (h: string) => void }) {
  const c = useConn(host);
  const [cwd, setCwd] = useState(() => localStorage.getItem(STORAGE_NEW_CWD) ?? "");
  const [dirs, setDirs] = useState<string[]>([]);
  const [instance, setInstance] = useState(() => localStorage.getItem(STORAGE_NEW_INSTANCE) ?? "");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = c.state === "ready";
  const inst = c.instances.find((i) => i.id === instance) ?? c.instances[0];

  useEffect(() => {
    localStorage.removeItem(STORAGE_NEW_CWD);
    localStorage.removeItem(STORAGE_NEW_INSTANCE);
  }, []);
  useEffect(() => {
    if (!ready) return;
    void c.c
      .hx<{ dirs: string[] }>("dirs/recent")
      .then((r) => {
        setDirs(r.dirs ?? []);
        setCwd((v) => v || r.dirs?.[0] || "");
      })
      .catch(() => undefined);
  }, [ready, c.c]);
  useEffect(() => {
    setModel(inst?.model ?? "");
    setMode(inst?.mode ?? "");
  }, [inst?.id, inst?.model, inst?.mode]);

  const start = async () => {
    const t = text.trim();
    if (!t || !inst || !cwd.trim() || busy) return;
    setBusy(true);
    try {
      const p: Record<string, string> = { instance: inst.id, cwd: cwd.trim(), title: t.split("\n")[0]!.slice(0, TITLE_MAX) };
      if (model.trim()) p.model = model.trim();
      if (mode.trim()) p.mode = mode.trim();
      const info = await c.c.hx<SessionInfo>("session/create", p, 60_000);
      c.c.putSession(info);
      void c.c.acpRequest(info.id, "session/prompt", { prompt: [{ type: "text", text: t }] }).catch((e: Error) => toast.error(e.message));
      location.hash = sessionLink(host, info.id);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  const hosts = allPairs().map((p) => ({ value: p.host, name: p.host }));
  const blocked = !host ? "先在设置里配对一台主机" : c.state === "unpaired" ? TXT_UNPAIRED : c.state === "noroute" ? TXT_NO_ROUTE : !ready ? (c.err || "正在连接主机") : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h2 className="text-2xl font-semibold text-foreground">今天让 Agent 做点什么?</h2>
        <p className="text-sm text-muted-foreground">{blocked || "选好主机, 项目目录与 Agent 实例, 发出第一条消息就开始"}</p>
        {blocked && (
          <Button variant="outline" size="sm" asChild>
            <a href={guiLink(SETTINGS)}>去设置</a>
          </Button>
        )}
      </div>
      <div className="mx-auto w-full max-w-[768px] px-4 pb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Pick label="主机" value={host} onChange={onHost} items={hosts} />
          <Input size="sm" list="ag-dirs" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="项目目录" className="w-64 font-mono" aria-label="项目目录" />
          <datalist id="ag-dirs">
            {dirs.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <Pick label="Agent 实例" value={inst?.id ?? ""} onChange={setInstance} items={c.instances.map((i) => ({ value: i.id, name: i.name }))} />
          <Input size="sm" value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型 (默认)" className="w-36" aria-label="模型" />
          <Input size="sm" value={mode} onChange={(e) => setMode(e.target.value)} placeholder="权限模式 (默认)" className="w-36" aria-label="权限模式" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-2 shadow-sm">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void start();
              }
            }}
            rows={3}
            disabled={!ready || busy}
            placeholder="描述要做的事, 回车开始"
            className="max-h-60 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            aria-label="第一条消息"
          />
          <div className="flex justify-end">
            <Button size="icon-sm" onClick={() => void start()} disabled={!ready || busy || !text.trim() || !cwd.trim() || !inst} aria-label="开始">
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
