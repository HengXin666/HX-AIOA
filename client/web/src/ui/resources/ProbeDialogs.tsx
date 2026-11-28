import type { HostCard } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@hx/ui/ui/dialog";
import { Field } from "@hx/ui/ui/field";
import { Input } from "@hx/ui/ui/input";
import { Switch } from "@hx/ui/ui/switch";
import { Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TXT_SCOPE_DENIED } from "../../agentgui/constants";
import type { AgentDenied } from "../../agentgui/types";
import { useResources } from "../../app/hooks";
import { addProbeScope, createProbe, installCommand, SCOPE_AGENT } from "../../core/probes";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const copy = (t: string, ok: string) => void navigator.clipboard.writeText(t).then(() => toast.success(ok));

// 探针报了 agent.denied === "scope": 本机开了 AIOA_AGENT, 但 key 没有 probe:agent
export const agentDenied = (card?: HostCard): boolean => (card?.info.agent as AgentDenied | undefined)?.denied === "scope";

export function useAgentDenied(subject: string): { denied: boolean; shell: boolean } {
  const { hosts } = useResources();
  const card = hosts.find((h) => h.subject === subject);
  return { denied: agentDenied(card), shell: card?.info.shell === true };
}

function CommandBox({ command, note }: { command: string; note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{note}</p>
      <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap text-foreground">{command}</pre>
      <Button className="self-start" onClick={() => copy(command, "安装命令已复制")}>
        <Copy />
        复制命令
      </Button>
    </div>
  );
}

// 添加主机: 建一把只给这台机器用的 key, 可勾终端与 Agent (probe:agent), 给出一行安装命令
export function AddHostDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState("");
  const [shell, setShell] = useState(false);
  const [agent, setAgent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState("");
  const valid = NAME_RE.test(name);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setName("");
      setCommand("");
    }
  };
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await createProbe(name, { shell, agent });
      setCommand(r.command || installCommand(r.subject, r.key, { shell: r.shell, agent: r.agent }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>添加主机</DialogTitle>
          <DialogDescription>在要接入的电脑上运行生成的命令; key 只显示这一次。</DialogDescription>
        </DialogHeader>
        {command ? (
          <CommandBox command={command} note={agent ? "已带 --agent: 探针会开启 Agent GUI, 装好后到 Agent > 编程 里配对这台主机。" : "复制到那台电脑的终端运行。"} />
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="名字" description="小写字母, 数字和 -, 最长 32 位">
              <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} onKeyDown={(e) => e.key === "Enter" && void submit()} placeholder="pc" autoFocus />
            </Field>
            <label className="flex items-center justify-between gap-3 text-sm text-foreground">
              <span>
                Agent
                <span className="block text-xs text-muted-foreground">在这台电脑上驱动编程 Agent (Agent GUI), key 带 probe:agent</span>
              </span>
              <Switch checked={agent} onCheckedChange={setAgent} aria-label="Agent" />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-foreground">
              <span>
                终端
                <span className="block text-xs text-muted-foreground">允许从这里打开这台电脑的终端, key 带 probe:shell</span>
              </span>
              <Switch checked={shell} onCheckedChange={setShell} aria-label="终端" />
            </label>
            <Button className="self-end" onClick={() => void submit()} disabled={!valid || busy}>
              {busy ? "生成中" : "生成安装命令"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// 主机卡 / Agent GUI 主机选择处的提示: 一键补 probe:agent; 换了新 key 就给重装命令
export function ScopeFix({ subject, shell, compact }: { subject: string; shell?: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState("");
  const fix = async () => {
    setBusy(true);
    try {
      const r = await addProbeScope(subject, [SCOPE_AGENT]);
      if (!r.ok) throw new Error("没有补上");
      if (r.key) setCommand(r.command || installCommand(subject, r.key, { shell, agent: true }));
      else toast.success("已补上 probe:agent, 探针重连后生效");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 text-warning ${compact ? "p-2 text-xs" : "p-3 text-sm"}`}>
      <KeyRound className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{TXT_SCOPE_DENIED}</span>
      <Button size="sm" variant="outline" onClick={() => void fix()} disabled={busy}>
        {busy ? "处理中" : "补上权限"}
      </Button>
      <Dialog open={Boolean(command)} onOpenChange={(o) => !o && setCommand("")}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>用新 key 重装 {subject} 的探针</DialogTitle>
            <DialogDescription>新 key 只显示这一次, 旧 key 已停用。</DialogDescription>
          </DialogHeader>
          <CommandBox command={command} note="在那台电脑上运行, 会覆盖原来的安装。" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
