import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@hx/ui/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@hx/ui/ui/dropdown-menu";
import { Input } from "@hx/ui/ui/input";
import { BookOpen, ChevronDown, Ellipsis, Plus, Search, Settings } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TXT_NEW_SESSION } from "../../../agentgui/constants";
import { useAgHub, useConn, usePairs } from "../../../agentgui/hooks";
import { allPairs } from "../../../agentgui/pairs";
import type { SessionInfo } from "../../../agentgui/types";
import { agentDenied, ScopeFix, useAgentDenied } from "../../resources/ProbeDialogs";
import { useResources } from "../../../app/hooks";
import { AddDel } from "./Diff";
import { STORAGE_NEW_CWD } from "./NewSession";
import { ago, AgentGlyph, basename, GUIDE, guiLink, RouteBadge, SETTINGS, sessionLink, StateDot } from "./parts";

type Row = Pick<SessionInfo, "id" | "title" | "agent" | "state" | "updated" | "pending"> & Partial<SessionInfo>;

// 左栏: 主机切换 (路线), 搜索, 新会话, 需要你, 项目 > 会话, 设置
export function Sidebar({ host, sid, onHost }: { host: string; sid?: string; onHost: (h: string) => void }) {
  usePairs();
  const hub = useAgHub();
  const c = useConn(host);
  const [q, setQ] = useState("");
  const hubHost = hub.hosts.find((h) => h.subject === host);
  const direct = c.state === "ready" || c.sessions.length > 0;
  const rows: Row[] = direct ? c.sessions : (hubHost?.sessions ?? []);
  const shown = rows.filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase()));
  const cardSids = new Set(hub.cards.filter((x) => x.host === host).map((x) => x.sid));
  const need = shown.filter((r) => r.state === "waiting" || r.pending > 0 || cardSids.has(r.id));
  const groups = new Map<string, Row[]>();
  for (const r of shown) {
    const k = r.cwd ?? "";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const paired = allPairs().map((p) => p.host);
  const others = hub.hosts.map((h) => h.subject).filter((h) => !paired.includes(h));
  const cur = rows.find((r) => r.id === sid);
  const scope = useAgentDenied(host);
  const { hosts: cards } = useResources();
  const lacks = (h: string) => agentDenied(cards.find((x) => x.subject === h));

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-[52px] items-center gap-2 border-b border-border px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start">
              <span className="truncate font-semibold">{host || "选主机"}</span>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>已配对</DropdownMenuLabel>
            {paired.map((h) => (
              <DropdownMenuItem key={h} onSelect={() => onHost(h)}>
                {h}
                {lacks(h) && <span className="ml-auto text-xs text-warning">缺权限</span>}
              </DropdownMenuItem>
            ))}
            {paired.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">还没有</p>}
            {others.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>未配对 (只能审批)</DropdownMenuLabel>
                {others.map((h) => (
                  <DropdownMenuItem key={h} onSelect={() => onHost(h)}>
                    {h}
                    {lacks(h) && <span className="ml-auto text-xs text-warning">缺权限</span>}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => (location.hash = guiLink(SETTINGS))}>配对新主机</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {host && <RouteBadge route={c.route} state={c.state} />}
      </div>
      <div className="flex flex-col gap-2 p-2">
        {scope.denied && <ScopeFix subject={host} shell={scope.shell} compact />}
        <Input size="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索会话" leading={<Search className="size-4" />} />
        <Button
          variant="outline"
          className="w-full"
          onClick={(e) => {
            if (e.shiftKey && cur?.cwd) localStorage.setItem(STORAGE_NEW_CWD, cur.cwd);
            location.hash = guiLink();
          }}
          title="Shift+点: 在当前项目直接开"
        >
          <Plus />
          {TXT_NEW_SESSION}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {need.length > 0 && (
          <section className="mb-3">
            <h3 className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
              需要你
              <Badge variant="destructive">{need.length}</Badge>
            </h3>
            {need.map((r) => (
              <SessionRow key={`n${r.id}`} host={host} row={r} active={r.id === sid} direct={direct} />
            ))}
          </section>
        )}
        {[...groups.entries()].map(([cwd, list]) => (
          <section key={cwd} className="mb-3">
            <h3 className="truncate px-2 py-1 text-xs font-medium text-muted-foreground" title={cwd}>
              {cwd ? basename(cwd) : "会话"}
            </h3>
            {list.map((r) => (
              <SessionRow key={r.id} host={host} row={r} active={r.id === sid} direct={direct} />
            ))}
          </section>
        ))}
        {host && rows.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">{c.state === "ready" ? "还没有会话" : "连上主机后显示会话"}</p>}
      </div>
      <div className="flex flex-col border-t border-border py-1">
        <a href={guiLink(GUIDE)} className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground [&_svg]:size-4">
          <BookOpen />
          使用指引
        </a>
        <a href={guiLink(SETTINGS)} className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground [&_svg]:size-4">
          <Settings />
          设置: Agent 实例 · 设备 · 配对
        </a>
      </div>
    </aside>
  );
}

function SessionRow({ host, row, active, direct }: { host: string; row: Row; active: boolean; direct: boolean }) {
  const c = useConn(host);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const act = (m: string, p: object, after?: () => void) =>
    void c.c
      .hx(m, p)
      .then(() => after?.())
      .catch((e: Error) => toast.error(e.message));
  return (
    <div className={`group flex items-center gap-1 rounded-lg ${active ? "bg-accent" : "hover:bg-muted"}`}>
      <a href={sessionLink(host, row.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
        <StateDot state={row.state} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{row.title || "未命名"}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AgentGlyph name={row.agent} />
            <span className="truncate">{row.agent}</span>
            <span className="shrink-0">· {ago(row.updated)}前</span>
          </span>
        </span>
        <AddDel add={row.adds ?? 0} del={row.dels ?? 0} />
      </a>
      {direct && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="会话菜单" className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>重命名</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act("session/resume", { sid: row.id }, undefined)}>恢复 (重新载入)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act("session/close", { sid: row.id })}>结束 (留档)</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {renaming && <RenameDialog title={row.title} onClose={() => setRenaming(false)} onSave={(title) => c.c.hx<SessionInfo>("session/rename", { sid: row.id, title }).then(() => c.c.putSession({ ...(row as SessionInfo), title }))} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="删除会话?"
        description={`"${row.title || "未命名"}" 的记录会从主机上删掉, 不能恢复。`}
        confirmLabel="删除"
        tone="destructive"
        onConfirm={() => c.c.hx("session/delete", { sid: row.id }).then(() => c.c.dropSession(row.id))}
      />
    </div>
  );
}

// 重命名: 失败留在对话框里显示原因
function RenameDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (t: string) => Promise<unknown> }) {
  const [v, setV] = useState(title);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    const t = v.trim();
    if (!t || busy) return;
    if (t === title) return onClose();
    setBusy(true);
    setErr("");
    try {
      await onSave(t);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重命名会话</DialogTitle>
        </DialogHeader>
        <Input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void save()} autoFocus aria-label="新标题" />
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={busy || !v.trim()}>
            {busy ? "保存中" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
