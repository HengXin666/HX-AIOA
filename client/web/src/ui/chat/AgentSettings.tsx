import { Label } from "@hx/ui/ui/label";
import { PATH_CHAT_AGENT, PATH_CHAT_AGENT_PROMPT, PATH_CHAT_AGENT_ROTATE, PATH_CHAT_AGENTS, type AgentRequest, type ChatAgent, type ChatMeta, type OnboardResult } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@hx/ui/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@hx/ui/ui/dropdown-menu";
import { Field } from "@hx/ui/ui/field";
import { Input } from "@hx/ui/ui/input";
import { Switch } from "@hx/ui/ui/switch";
import { Textarea } from "@hx/ui/ui/textarea";
import { Bot, Copy, Ellipsis, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, fill } from "../../core/auth";
import { chats, titleOf } from "../../core/chats";
import { shortTime } from "../ChatList";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const copy = (t: string, ok: string) => void navigator.clipboard.writeText(t).then(() => toast.success(ok));
const MINUTE = 60;

// 群 Agent 设置 (对照安卓 ch-agentset / ag-edit / ag-guide / ag-wizard, 主人可见): 接入, 复制接入语, 改名与可读的群, 重新接入, 移出
export function AgentSettings({ meta, listening }: { meta: ChatMeta; listening: Set<string> }) {
  const [wizard, setWizard] = useState(false);
  const [edit, setEdit] = useState<ChatAgent | null>(null);
  const [result, setResult] = useState<{ title: string; prompt: string; key?: string } | null>(null);
  const ch = meta.channel;
  const list = meta.agents ?? [];

  const prompt = (a: ChatAgent) =>
    void api<{ prompt: string }>(fill(PATH_CHAT_AGENT_PROMPT, ch, a.keyId)).then((r) => setResult({ title: `${a.name} 的接入语`, prompt: r.prompt }), err);
  const rotate = (a: ChatAgent) =>
    api<OnboardResult>(fill(PATH_CHAT_AGENT_ROTATE, ch, a.keyId), { method: "POST" }).then((r) => setResult({ title: `重新接入 ${a.name}`, prompt: r.prompt, key: r.key }));
  const patch = (a: ChatAgent, p: Partial<AgentRequest & { autoMajor: boolean }>) => void api(fill(PATH_CHAT_AGENT, ch, a.keyId), { method: "PATCH", body: JSON.stringify(p) }).catch(err);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        Agent ({list.length})
        <Button size="xs" variant="ghost" onClick={() => setWizard(true)}>
          <Plus />
          接入
        </Button>
      </h3>
      {list.map((a) => (
        <div key={a.keyId} className="flex items-center gap-2 text-sm">
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-foreground">{a.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {a.client ?? "还没报到"}
              {a.active ? ` · ${shortTime(a.active)} 活跃` : ""}
            </p>
          </div>
          {listening.has(a.keyId) ? (
            <Badge variant="outline" dot="success">
              在听
            </Badge>
          ) : a.pending ? (
            <Badge variant="outline" dot="warning">
              待报到
            </Badge>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label="Agent 操作">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => prompt(a)}>
                <Copy />
                接入语
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEdit(a)}>编辑</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => patch(a, { autoMajor: !a.autoMajor })}>{a.autoMajor ? "关闭" : "开启"}大更新自动执行</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void rotate(a).catch(err)}>重新接入 (换 key)</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void api(fill(PATH_CHAT_AGENT, ch, a.keyId), { method: "DELETE" }).then(() => toast.success(`已移出 ${a.name}`), err)}>
                移出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      {!list.length && <p className="text-xs text-muted-foreground">还没有 Agent。接入后它能读这个群并回复, 接入语原样发给它即可。</p>}
      {wizard && (
        <AgentForm
          channel={ch}
          onClose={() => setWizard(false)}
          onSubmit={async (p) => {
            const r = await api<OnboardResult>(fill(PATH_CHAT_AGENTS, ch), { method: "POST", body: JSON.stringify(p) });
            setWizard(false);
            setResult({ title: `接入 ${r.agent.name}`, prompt: r.prompt, key: r.key });
          }}
        />
      )}
      {edit && (
        <AgentForm
          channel={ch}
          agent={edit}
          onClose={() => setEdit(null)}
          onSubmit={async (p) => {
            await api(fill(PATH_CHAT_AGENT, ch, edit.keyId), { method: "PATCH", body: JSON.stringify({ name: p.name, reads: p.reads }) });
            setEdit(null);
          }}
        />
      )}
      {result && <PromptDialog {...result} onClose={() => setResult(null)} />}
    </section>
  );
}

function AgentForm({ channel, agent, onClose, onSubmit }: { channel: string; agent?: ChatAgent; onClose: () => void; onSubmit: (p: AgentRequest) => Promise<void> }) {
  const [name, setName] = useState(agent?.name ?? "");
  const [reads, setReads] = useState<string[]>(agent?.reads ?? []);
  const [every, setEvery] = useState("");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const others = chats.ordered().filter((c) => c.channel !== channel && c.view !== "mail");
  const submit = async () => {
    setBusy(true);
    try {
      const p: AgentRequest = { name: name.trim(), reads };
      if (!agent && Number(every) > 0) p.interval = Math.round(Number(every) * MINUTE);
      if (!agent && task.trim()) p.task = task.trim();
      await onSubmit(p);
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{agent ? `编辑 ${agent.name}` : "接入 Agent"}</DialogTitle>
          <DialogDescription>{agent ? "改名与可读的群, key 不变。" : "生成一把只属于这个群的 key 和接入语, 原样发给 Agent。"}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <Field label="名字">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 Codex" />
          </Field>
          {others.length > 0 && (
            <Field label="还能读这些群 (可选)">
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
                {others.map((c) => (
                  <Label key={c.channel} className="flex items-center gap-2 text-sm">
                    <Switch size="sm" checked={reads.includes(c.channel)} onCheckedChange={(v) => setReads((r) => (v ? [...r, c.channel] : r.filter((x) => x !== c.channel)))} />
                    {titleOf(c)}
                  </Label>
                ))}
              </div>
            </Field>
          )}
          {!agent && (
            <>
              <Field label="定时 (分钟, 可选)">
                <Input type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} />
              </Field>
              <Field label="任务 (可选, 只写进这次的接入语)">
                <Textarea rows={3} value={task} onChange={(e) => setTask(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        <Button disabled={busy || !name.trim()} onClick={() => void submit()}>
          {agent ? "保存" : "生成接入语"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function PromptDialog({ title, prompt, key, onClose }: { title: string; prompt: string; key?: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{key ? "key 只显示这一次; 接入语里已经带上。" : "原样发给 Agent。"}</DialogDescription>
        </DialogHeader>
        <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-muted p-3 text-xs break-words whitespace-pre-wrap text-foreground">{prompt}</pre>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => copy(prompt, "接入语已复制")}>
            <Copy />
            复制接入语
          </Button>
          {key && (
            <Button variant="outline" onClick={() => copy(key, "key 已复制")}>
              复制 key
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
