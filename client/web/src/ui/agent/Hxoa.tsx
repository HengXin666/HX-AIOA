import { Label } from "@hx/ui/ui/label";
import { Card } from "@hx/ui/ui/card";
import type { HxoaBrowse, HxoaConn, HxoaState, HxoaToken, HxoaWorkspace } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@hx/ui/ui/dialog";
import { Field } from "@hx/ui/ui/field";
import { Input } from "@hx/ui/ui/input";
import { Switch } from "@hx/ui/ui/switch";
import { ChevronDown, ChevronRight, Copy, Folder, GitMerge, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "../../core/auth";
import { TXT_LOADING } from "../../core/constants";
import * as hx from "../../core/hxoa";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const copy = (t: string, ok = "已复制") => void navigator.clipboard.writeText(t).then(() => toast.success(ok));
const LABEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;

// hxoa 分组 (对照安卓 ui/hxoa, #144): 工作区, worker, 连接令牌; 插件没启用 (接口 403 / 404) 时整组不显示
export function HxoaSection() {
  const [conns, setConns] = useState<HxoaConn[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const reload = () =>
    void hx.hxoaConns().then(setConns, (e) => (e instanceof ApiError && (e.status === 403 || e.status === 404) ? setHidden(true) : err(e)));
  useEffect(reload, []);
  if (hidden) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center text-sm font-medium text-muted-foreground">
        <span className="flex-1">hxoa</span>
        <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>
          <Plus />
          接入 hxoa
        </Button>
      </h3>
      {!conns && <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>}
      {conns?.length === 0 && <p className="text-sm text-muted-foreground">还没有接入, 在 hxoa 面板 "远程管理" 里建管理令牌 (hxadm_ 开头)。</p>}
      {conns?.map((c) => <Conn key={c.id} c={c} onChanged={reload} />)}
      {adding && <AddConn onClose={() => setAdding(false)} onDone={reload} />}
    </section>
  );
}

function Conn({ c, onChanged }: { c: HxoaConn; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<HxoaState | null>(null);
  const [addWs, setAddWs] = useState(false);
  const load = () => void hx.hxoaState(c.id).then(setState, err);
  useEffect(() => {
    if (open) load();
  }, [open]);
  const online = Boolean(c.hello);
  return (
    <Card className=" gap-0 py-0">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 p-3 text-left [&_svg]:size-4">
        {open ? <ChevronDown /> : <ChevronRight />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{c.hello ? `${c.hello.server} · ${c.hello.publicUrl || c.base}` : (c.error ?? c.base)}</span>
        </span>
        <Badge variant="outline" dot={online ? "success" : c.kind === "agent" ? "destructive" : "muted"}>
          {online ? "在线" : c.kind === "agent" ? "旧版, 需重接" : "离线"}
        </Badge>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {!state && <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>}
          {state?.tunnel && (
            <p className="text-xs text-muted-foreground">
              隧道 {state.tunnel.mode} · {state.tunnel.state}
              {state.tunnel.error ? ` · ${state.tunnel.error}` : ""}
            </p>
          )}
          {state?.workspaces.map((w) => <Workspace key={w.id} id={c.id} w={w} onChanged={load} />)}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!online} onClick={() => setAddWs(true)}>
              <Plus />
              添加工作区
            </Button>
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw />
              刷新
            </Button>
            <ConfirmDialog
              trigger={<Button size="sm" variant="ghost">移除接入</Button>}
              title={`移除 ${c.name}?`}
              description="只删除这里保存的管理令牌, hxoa 那边不受影响。"
              confirmLabel="移除"
              tone="destructive"
              onConfirm={() => hx.hxoaRemove(c.id).then(onChanged)}
            />
          </div>
          {addWs && <AddWorkspace id={c.id} onClose={() => setAddWs(false)} onDone={load} />}
        </div>
      )}
    </Card>
  );
}

function Workspace({ id, w, onChanged }: { id: string; w: HxoaWorkspace; onChanged: () => void }) {
  const [label, setLabel] = useState("");
  const patch = (p: { workers?: boolean; exec?: boolean }) => void hx.hxoaPatchWs(id, w.id, p).then(onChanged, err);
  const newToken = async () => {
    try {
      const r = await hx.hxoaAddToken(id, w.id, label.trim());
      copy(r.prompt, "连接提示已复制, 原样发给 AI");
      setLabel("");
      onChanged();
    } catch (e) {
      err(e);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{w.name}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {w.path}
            {w.branch ? ` · ${w.branch}` : ""}
          </span>
        </span>
        <Badge variant="secondary">{w.online} 在线</Badge>
        <ConfirmDialog
          trigger={<Button size="icon-xs" variant="ghost" aria-label="删除工作区"><Trash2 /></Button>}
          title={`删除工作区 ${w.name}?`}
          description="会吊销它的所有连接令牌; 目录本身不动。"
          confirmLabel="删除"
          tone="destructive"
          onConfirm={() => hx.hxoaDropWs(id, w.id).then(onChanged)}
        />
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-foreground">
        <Label className="flex items-center gap-2">
          <Switch size="sm" checked={w.workers} disabled={!w.git} onCheckedChange={(v) => patch({ workers: v })} />
          workers{!w.git ? " (需要 git)" : ""}
        </Label>
        <Label className="flex items-center gap-2">
          <Switch size="sm" checked={w.exec} onCheckedChange={(v) => patch({ exec: v })} />
          允许执行命令
        </Label>
      </div>
      {w.tokens.map((t) => (
        <Token key={t.id} id={id} t={t} onChanged={onChanged} />
      ))}
      <div className="flex gap-2">
        <Input size="sm" placeholder="新连接的身份名, 如 hark" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button size="sm" disabled={!LABEL_RE.test(label.trim())} onClick={() => void newToken()}>
          新建连接
        </Button>
      </div>
    </div>
  );
}

function Token({ id, t, onChanged }: { id: string; t: HxoaToken; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const merge = async () => {
    setBusy(true);
    try {
      const out = await hx.hxoaMerge(id, t.id);
      toast.success("已合并", { description: out.slice(0, 300) });
      onChanged();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  const w = t.worker;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Badge variant="outline" dot={t.online ? "success" : "muted"}>
        {t.label}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {t.ops} 次操作
        {w?.exists ? ` · ${w.branch}${w.ahead ? ` 领先 ${w.ahead}` : ""}${w.behind ? ` 落后 ${w.behind}` : ""}${w.dirty?.length ? ` · ${w.dirty.length} 个未提交` : ""}` : ""}
      </span>
      <Button size="icon-xs" variant="ghost" aria-label="复制连接提示" title="复制连接提示" onClick={() => void hx.hxoaPrompt(id, t.id).then((p) => copy(p, "连接提示已复制"), err)}>
        <Copy />
      </Button>
      {w?.exists && (
        <Button size="icon-xs" variant="ghost" aria-label="合并" title="合并到当前分支" disabled={busy || !w.ahead} onClick={() => void merge()}>
          <GitMerge />
        </Button>
      )}
      <ConfirmDialog
        trigger={<Button size="icon-xs" variant="ghost" aria-label="删除连接"><Trash2 /></Button>}
        title={`删除连接 ${t.label}?`}
        description="它立刻失去访问权; 已全部合并的分支和干净的工作树一起删掉。"
        confirmLabel="删除"
        tone="destructive"
        onConfirm={() => hx.hxoaDropToken(id, t.id).then(onChanged)}
      />
    </div>
  );
}

function AddConn({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [base, setBase] = useState("https://");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await hx.hxoaAdd({ name: name.trim(), base: base.trim(), token: token.trim() });
      onDone();
      onClose();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>接入 hxoa</DialogTitle>
          <DialogDescription>在 hxoa 面板 "远程管理" 里建管理令牌 (需 2.4.1+)。令牌只存在服务端, 加密保存。</DialogDescription>
        </DialogHeader>
        <Field label="名字">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="服务地址">
          <Input value={base} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <Field label="管理令牌 (hxadm_ 开头)">
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
        <Button disabled={busy || !name.trim() || !token.trim()} onClick={() => void submit()}>
          {busy ? "验证中" : "接入"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// 选目录: 从 hxoa 那台机器的家目录开始逐级点进去
function AddWorkspace({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [dir, setDir] = useState<HxoaBrowse | null>(null);
  const [name, setName] = useState("");
  const [workers, setWorkers] = useState(false);
  const [exec, setExec] = useState(true);
  const go = (path: string) => void hx.hxoaBrowse(id, path).then(setDir, err);
  useEffect(() => go(""), []);
  const submit = async () => {
    if (!dir) return;
    try {
      await hx.hxoaAddWs(id, { name: name.trim(), path: dir.path, workers: workers && dir.git, exec });
      onDone();
      onClose();
    } catch (e) {
      err(e);
    }
  };
  const join = (p: string, d: string) => `${p.replace(/\/+$/, "")}/${d}`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>添加工作区</DialogTitle>
          <DialogDescription className="font-mono break-all">{dir?.path ?? TXT_LOADING}</DialogDescription>
        </DialogHeader>
        <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
          {dir && dir.parent && dir.parent !== dir.path && (
            <li>
              <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => go(dir.parent)}>
                ..
              </button>
            </li>
          )}
          {dir?.dirs.map((d) => (
            <li key={d}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted [&_svg]:size-4" onClick={() => go(join(dir.path, d))}>
                <Folder className="text-muted-foreground" />
                {d}
              </button>
            </li>
          ))}
        </ul>
        <Field label="名字 (可选)">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Label className="flex items-center gap-2 text-sm">
          <Switch size="sm" checked={workers && Boolean(dir?.git)} disabled={!dir?.git} onCheckedChange={setWorkers} />
          workers (每个连接独立 git 工作树){dir && !dir.git ? ", 这里不是 git 仓库" : ""}
        </Label>
        <Label className="flex items-center gap-2 text-sm">
          <Switch size="sm" checked={exec} onCheckedChange={setExec} />
          允许执行命令
        </Label>
        <Button disabled={!dir} onClick={() => void submit()}>
          用这个目录
        </Button>
      </DialogContent>
    </Dialog>
  );
}
