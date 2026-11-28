import { MAX_AGENT_TASK, PATH_CHAT_AGENTS, type OnboardResult } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hx/ui/ui/dialog";
import { Input } from "@hx/ui/ui/input";
import { Textarea } from "@hx/ui/ui/textarea";
import { useState } from "react";
import { toast } from "sonner";
import { useChats } from "../../app/hooks";
import { api, fill } from "../../core/auth";
import { chats } from "../../core/chats";
import { TASK_EXAMPLE, TASK_TEMPLATES, TASK_TIPS, TXT_AGENT_INTRO, TXT_SCHEDULE, nextSteps } from "./onboard-text";

// 接入群 Agent (#161): 1 名字与任务 (附写法引导, 定时不用选), 2 复制接入语并等它报到
const NAME_MAX = 40;
const KEY_SHOWN = 8;
const SOFT_BOX = "rounded-lg bg-muted/60 px-3 py-2 text-sm";
const masked = (text: string, key: string) => (key ? text.replaceAll(key, `${key.slice(0, KEY_SHOWN)}••••••`) : text);

export function AgentOnboard({ channel, open, onClose }: { channel: string; open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<OnboardResult | null>(null);
  const close = () => {
    if (busy) return;
    setName("");
    setTask("");
    setDone(null);
    onClose();
  };
  const create = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim(), reads: [channel], ...(task.trim() ? { task: task.trim() } : {}) };
      setDone(await api<OnboardResult>(fill(PATH_CHAT_AGENTS, channel), { method: "POST", body: JSON.stringify(body) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{done ? `发给 ${done.agent.name}` : "接入群 Agent"}</DialogTitle>
          <DialogDescription>{done ? "整段接入语发给它, 它会自己装好, 建定时并报到。密钥只显示这一次。" : TXT_AGENT_INTRO}</DialogDescription>
        </DialogHeader>
        {done ? <SendStep channel={channel} ob={done} /> : <FormStep name={name} setName={setName} task={task} setTask={setTask} />}
        <DialogFooter>
          {done ? (
            <Button onClick={close}>完成</Button>
          ) : (
            <Button disabled={!name.trim() || busy} onClick={() => void create()}>
              {busy ? "正在生成..." : "生成接入语"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FormProps = { name: string; setName: (v: string) => void; task: string; setTask: (v: string) => void };

function FormStep({ name, setName, task, setTask }: FormProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        叫什么
        <Input value={name} maxLength={NAME_MAX} placeholder="如 整理员" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">让它做什么</span>
        <div className="flex flex-wrap gap-1.5">
          {TASK_TEMPLATES.map((t) => (
            <Button key={t.label} size="sm" variant={task === t.task && t.task ? "default" : "outline"} onClick={() => setTask(t.task)}>
              {t.label}
            </Button>
          ))}
        </div>
        <Textarea value={task} maxLength={MAX_AGENT_TASK} rows={3} placeholder="可以留空, 之后在群里跟它说" onChange={(e) => setTask(e.target.value)} />
      </div>
      <details className={SOFT_BOX}>
        <summary className="cursor-pointer font-medium">任务怎么写</summary>
        <p className="mt-2">像交代给同事一样, 一两句写清四件事:</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          {TASK_TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">{TASK_EXAMPLE}</p>
      </details>
      <p className="text-xs text-muted-foreground">{TXT_SCHEDULE}</p>
    </div>
  );
}

function SendStep({ channel, ob }: { channel: string; ob: OnboardResult }) {
  useChats();
  const [show, setShow] = useState(false);
  const live = chats.meta(channel)?.agents?.find((a) => a.keyId === ob.agent.keyId);
  const joined = !!live?.joined && !live.pending;
  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`已复制${what}`));
  return (
    <div className="flex flex-col gap-3">
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs">{show ? ob.prompt : masked(ob.prompt, ob.key)}</pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => copy(ob.prompt, "接入语")}>
          复制接入语
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy(ob.key, "密钥")}>
          只复制密钥
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShow(!show)}>
          {show ? "隐藏密钥" : "显示密钥"}
        </Button>
      </div>
      <div className={`flex items-center gap-2 ${SOFT_BOX}`}>
        <Badge variant="outline" dot={joined ? "success" : "warning"}>
          {joined ? "已接入" : "等待报到"}
        </Badge>
        <span>{joined ? `${ob.agent.name} 已接入, 可以关掉了` : `等 ${ob.agent.name} 照接入语做完`}</span>
      </div>
      <div className={SOFT_BOX}>
        <p className="font-medium">接下来</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {nextSteps(ob.agent.name).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
