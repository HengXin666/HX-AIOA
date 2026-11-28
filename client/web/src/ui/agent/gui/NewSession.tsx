import { Button } from "@hx/ui/ui/button";
import { Input } from "@hx/ui/ui/input";
import { ComposerSelect, PromptInput } from "@hx/ui/agent";
import { Bot, Folder, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CREATE_SLOW_MS, CREATE_TIMEOUT_MS, TXT_CREATE_SLOW, TXT_NO_ROUTE, TXT_UNPAIRED } from "../../../agentgui/constants";
import { useAgHub, useConn } from "../../../agentgui/hooks";
import { allPairs } from "../../../agentgui/pairs";
import type { SessionInfo } from "../../../agentgui/types";
import { STORAGE_NEW_INSTANCE } from "./ModelPanel";
import { GuideCard, useGuide } from "./Guide";
import { LoginCard } from "./Login";
import { ApproveOnly, basename, GUIDE, guiLink, SETTINGS, sessionLink } from "./parts";

export const STORAGE_NEW_CWD = "aioa.ag.newCwd";
const TITLE_MAX = 40;
const RECENT_DIRS = 6;

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
  const [slow, setSlow] = useState(false);
  const hub = useAgHub();
  const g = useGuide(host);
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
    setSlow(false);
    c.c.clearLogin();
    // 第一次用某个 Agent 时 npx 要下载适配器, 可能几分钟
    const slowTimer = setTimeout(() => setSlow(true), CREATE_SLOW_MS);
    try {
      const p: Record<string, string> = { instance: inst.id, cwd: cwd.trim(), title: t.split("\n")[0]!.slice(0, TITLE_MAX) };
      if (model.trim()) p.model = model.trim();
      if (mode.trim()) p.mode = mode.trim();
      const info = await c.c.hx<SessionInfo>("session/create", p, CREATE_TIMEOUT_MS);
      c.c.putSession(info);
      void c.c.acpRequest(info.id, "session/prompt", { prompt: [{ type: "text", text: t }] }).catch((e: Error) => toast.error(e.message));
      location.hash = sessionLink(host, info.id);
    } catch (e) {
      // 未登录时探针另发 auth_required, 由登录卡说明, 不再弹一条
      if (!c.c.snapshot().login) toast.error((e as Error).message);
      setBusy(false);
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
    }
  };

  const hosts = allPairs().map((p) => ({ value: p.host, name: p.host }));
  const approveOnly = c.state === "noroute" || c.state === "unreachable";
  const blocked = !host ? "先在设置里配对一台主机" : c.state === "unpaired" ? TXT_UNPAIRED : approveOnly ? c.err || TXT_NO_ROUTE : !ready ? c.err || "正在连接主机" : "";
  const login = c.login && (!c.login.instance || c.login.instance === inst?.id) && !c.login.sid ? c.login : null;
  const pending = hub.cards.filter((x) => x.host === host).length;

  const project = cwd.trim() ? basename(cwd.trim()) : "";
  const chip = "h-7 rounded-full border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground focus-visible:bg-accent";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-[768px] flex-1 flex-col justify-center gap-6 px-4 pb-[12vh]">
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-foreground">
            {project ? (
              <>
                要在 <span className="text-brand">{project}</span> 里做点什么?
              </>
            ) : (
              "今天让 Agent 做点什么?"
            )}
          </h2>
          {g.step && g.step !== "route" && g.step !== "login" ? (
            <GuideCard g={g} />
          ) : approveOnly ? (
            <ApproveOnly text={blocked} n={pending} onRetry={c.state === "unreachable" ? () => c.c.kick() : undefined} />
          ) : (
            <p className="text-sm text-muted-foreground">{blocked || "选好项目与 Agent, 发出第一条消息就开始"}</p>
          )}
          {blocked && !approveOnly && !g.step && (
            <Button variant="outline" size="sm" asChild>
              <a href={guiLink(SETTINGS)}>去设置</a>
            </Button>
          )}
          {approveOnly && (
            <a href={guiLink(GUIDE)} className="text-xs text-muted-foreground underline hover:text-foreground">
              为什么只能审批?
            </a>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {login && <LoginCard conn={c.c} login={login} instance={inst} onDone={() => void start()} />}
          {busy && slow && (
            <p role="status" className="text-center text-xs text-muted-foreground">
              {TXT_CREATE_SLOW}
            </p>
          )}
          <PromptInput
            value={text}
            onValueChange={setText}
            onSubmit={() => void start()}
            busy={busy}
            disabled={!ready}
            attachments={false}
            autoFocus
            placeholder={ready ? "描述要做的事, 回车开始" : blocked || "正在连接主机"}
            busyPlaceholder="正在启动 Agent"
            toolbar={
              c.instances.length > 0 && (
                <ComposerSelect label="Agent 实例" options={c.instances.map((i) => ({ value: i.id, label: i.name, description: i.cmd, icon: <Bot /> }))} value={inst?.id ?? ""} onValueChange={setInstance} />
              )
            }
          />
          <div className="flex flex-wrap items-center gap-1 px-1">
            {hosts.length > 0 && <ComposerSelect label="主机" options={hosts.map((h) => ({ value: h.value, label: h.name, icon: <Monitor /> }))} value={host} onValueChange={onHost} />}
            <span className="flex items-center text-muted-foreground">
              <Folder className="size-3.5" />
              <Input size="sm" list="ag-dirs" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="项目目录" className={`w-56 font-mono ${chip}`} aria-label="项目目录" />
            </span>
            <datalist id="ag-dirs">
              {dirs.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <Input size="sm" value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型 (默认)" className={`w-32 ${chip}`} aria-label="模型" />
            <Input size="sm" value={mode} onChange={(e) => setMode(e.target.value)} placeholder="权限模式 (默认)" className={`w-32 ${chip}`} aria-label="权限模式" />
          </div>
          {dirs.length > 0 && !cwd.trim() && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {dirs.slice(0, RECENT_DIRS).map((d) => (
                <Button key={d} size="xs" variant="outline" className="rounded-full font-mono" onClick={() => setCwd(d)} title={d}>
                  {basename(d)}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
