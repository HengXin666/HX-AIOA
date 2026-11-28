import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@hx/ui/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@hx/ui/ui/dropdown-menu";
import { Input } from "@hx/ui/ui/input";
import { Archive, BookOpen, ChevronDown, Ellipsis, Folder, FolderOpen, Monitor, PenLine, Pin, PinOff, Plus, Search, Settings, SquarePen } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemMeta, ItemTitle, ItemTrigger } from "@hx/ui/ui/item";
import { useState } from "react";
import { toast } from "sonner";
import { TXT_NEW_SESSION } from "../../../agentgui/constants";
import { useAgHub, useConn, usePairs } from "../../../agentgui/hooks";
import { allPairs } from "../../../agentgui/pairs";
import { agDrafts, agPrefs, key, useAgPrefs } from "../../../agentgui/prefs";
import { KeyOf } from "./Keys";
import type { SessionInfo } from "../../../agentgui/types";
import { agentDenied, ScopeFix, useAgentDenied } from "../../resources/ProbeDialogs";
import { useResources } from "../../../app/hooks";
import { AddDel } from "./Diff";
import { STORAGE_NEW_CWD } from "./NewSession";
import { ago, basename, GUIDE, guiLink, RouteBadge, SETTINGS, sessionLink, StateDot } from "./parts";

export const SEARCH_ID = "ag-session-search";
type Row = Pick<SessionInfo, "id" | "title" | "agent" | "state" | "updated" | "pending"> & Partial<SessionInfo>;

// 左栏: 主机切换 (路线), 搜索, 新会话, 需要你, 项目 > 会话, 设置
export function Sidebar({ host, sid, onHost }: { host: string; sid?: string; onHost: (h: string) => void }) {
  usePairs();
  const hub = useAgHub();
  const c = useConn(host);
  const prefs = useAgPrefs();
  const [q, setQ] = useState("");
  const hubHost = hub.hosts.find((h) => h.subject === host);
  const direct = c.state === "ready" || c.sessions.length > 0;
  const rows: Row[] = [...(direct ? c.sessions : (hubHost?.sessions ?? []))].sort((a, b) => b.updated - a.updated);
  const ql = q.toLowerCase();
  const hit = (r: Row) => !q || `${r.title} ${r.agent} ${r.cwd ?? ""}`.toLowerCase().includes(ql);
  // 与 t3code 一样: 置顶单列在最上, 归档默认收起 (搜索时也搜归档)
  const isSettled = (r: Row) => prefs.settled.includes(key(host, r.id));
  const shown = rows.filter((r) => hit(r) && (q !== "" || prefs.showSettled || !isSettled(r)));
  const settledN = rows.filter(isSettled).length;
  const cardSids = new Set(hub.cards.filter((x) => x.host === host).map((x) => x.sid));
  const need = shown.filter((r) => r.state === "waiting" || r.pending > 0 || cardSids.has(r.id));
  const pinned = shown.filter((r) => prefs.pinned.includes(key(host, r.id)));
  const groups = new Map<string, Row[]>();
  for (const r of shown) {
    if (pinned.includes(r)) continue;
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
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-border/60 bg-sidebar">
      <div className="flex h-12 items-center gap-1 px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start gap-2 px-2">
              <Monitor className="text-muted-foreground" />
              <span className="truncate font-semibold">{host || "选主机"}</span>
              <ChevronDown className="text-muted-foreground" />
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
      <div className="flex flex-col gap-1 px-2 pb-2">
        {scope.denied && <ScopeFix subject={host} shell={scope.shell} compact />}
        <Input id={SEARCH_ID} size="sm" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (setQ(""), e.currentTarget.blur())} placeholder="搜索会话" leading={<Search className="size-4" />} trailing={<KeyOf command="chat.find" className="opacity-60" />} />
        <Item
          asChild
          size="sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <button
            type="button"
            onClick={(e) => {
              if (e.shiftKey && cur?.cwd) localStorage.setItem(STORAGE_NEW_CWD, cur.cwd);
              location.hash = guiLink();
            }}
            title="Shift+点: 在当前项目直接开"
          >
            <ItemMedia variant="icon">
              <SquarePen />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="font-normal">{TXT_NEW_SESSION}</ItemTitle>
            </ItemContent>
            <KeyOf command="chat.new" className="opacity-60" />
          </button>
        </Item>
      </div>
      <ItemGroup size="sm" highlight="slide" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {need.length > 0 && (
          <section className="mb-1">
            <h3 className="flex items-center gap-2 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              需要你
              <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">{need.length}</Badge>
            </h3>
            {need.map((r) => (
              <SessionRow key={`n${r.id}`} host={host} row={r} active={r.id === sid} direct={direct} />
            ))}
          </section>
        )}
        {pinned.length > 0 && (
          <section className="mb-1">
            <h3 className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              <Pin className="size-3" />
              置顶
            </h3>
            {pinned.map((r) => (
              <SessionRow key={`p${r.id}`} host={host} row={r} active={r.id === sid} direct={direct} />
            ))}
          </section>
        )}
        {[...groups.entries()].map(([cwd, list]) => {
          const g = `${host}|${cwd}`;
          const folded = prefs.folded.includes(g) && !q;
          return (
            <section key={cwd} className="mb-1">
              <div className="group/proj flex items-center gap-1 pt-2 pb-1">
                <button type="button" onClick={() => agPrefs.toggleFold(g)} aria-expanded={!folded} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground" title={cwd}>
                  {folded ? <Folder className="size-3.5 shrink-0" /> : <FolderOpen className="size-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{cwd ? basename(cwd) : "会话"}</span>
                  <span className="tabular-nums opacity-60 group-hover/proj:hidden">{list.length}</span>
                </button>
                {cwd && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`在 ${basename(cwd)} 开新会话`}
                    className="hidden group-hover/proj:inline-flex"
                    onClick={() => {
                      localStorage.setItem(STORAGE_NEW_CWD, cwd);
                      location.hash = guiLink();
                    }}
                  >
                    <Plus />
                  </Button>
                )}
              </div>
              {!folded && list.map((r) => <SessionRow key={r.id} host={host} row={r} active={r.id === sid} direct={direct} />)}
            </section>
          );
        })}
        {settledN > 0 && !q && (
          <Button variant="ghost" size="xs" className="mx-2 text-muted-foreground" onClick={agPrefs.toggleShowSettled}>
            <Archive />
            {prefs.showSettled ? "收起归档" : `显示归档 (${settledN})`}
          </Button>
        )}
        {host && rows.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">{c.state === "ready" ? "还没有会话" : "连上主机后显示会话"}</p>}
      </ItemGroup>
      <ItemGroup size="sm" className="border-t border-border/60 p-2">
        <Item asChild size="sm" className="text-muted-foreground hover:text-foreground">
          <a href={guiLink(GUIDE)}>
            <ItemMedia variant="icon">
              <BookOpen />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="font-normal">使用指引</ItemTitle>
            </ItemContent>
          </a>
        </Item>
        <Item asChild size="sm" className="text-muted-foreground hover:text-foreground">
          <a href={guiLink(SETTINGS)}>
            <ItemMedia variant="icon">
              <Settings />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="font-normal">设置</ItemTitle>
            </ItemContent>
            <span className="text-xs opacity-60">实例 · 设备 · 配对</span>
          </a>
        </Item>
      </ItemGroup>
    </aside>
  );
}

function SessionRow({ host, row, active, direct }: { host: string; row: Row; active: boolean; direct: boolean }) {
  const c = useConn(host);
  const prefs = useAgPrefs();
  const k = key(host, row.id);
  const pinned = prefs.pinned.includes(k);
  const settled = prefs.settled.includes(k);
  const unread = !active && agPrefs.unread(k, row.updated) && (row.state === "idle" || row.state === "error");
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const act = (m: string, p: object, after?: () => void) =>
    void c.c
      .hx(m, p)
      .then(() => after?.())
      .catch((e: Error) => toast.error(e.message));
  const busy = row.state === "running" || row.state === "starting";
  const waiting = row.state === "waiting" || row.pending > 0;
  return (
    <Item size="sm" active={active} className="group/row">
      <StateDot state={row.state} className="mx-1" />
      <ItemContent>
        <ItemTitle className={unread ? "font-semibold" : settled ? "text-muted-foreground" : "font-normal"}>
          <ItemTrigger asChild>
            <a href={sessionLink(host, row.id)} title={`${row.title || "未命名"} · ${row.agent}${row.cwd ? ` · ${row.cwd}` : ""}`}>
              {row.title || "未命名"}
              {unread && <span role="img" aria-label="有新结果" className="ml-1.5 inline-block size-1.5 rounded-full bg-info align-middle" />}
              {agDrafts.has(k) && <PenLine className="ml-1.5 inline size-3 align-[-1px] text-muted-foreground" aria-label="有草稿" />}
            </a>
          </ItemTrigger>
        </ItemTitle>
      </ItemContent>
      <ItemMeta className="shrink-0 whitespace-nowrap">
        {waiting ? (
          <Badge variant="outline" dot="warning" className="h-5 px-1.5 text-[11px]">
            等你
          </Badge>
        ) : busy ? (
          <Badge variant="outline" dot="info" live className="h-5 px-1.5 text-[11px]">
            运行中
          </Badge>
        ) : row.adds || row.dels ? (
          <AddDel add={row.adds ?? 0} del={row.dels ?? 0} />
        ) : (
          <span className="tabular-nums">{ago(row.updated)}前</span>
        )}
      </ItemMeta>
      {direct && (
        <ItemActions reveal="swap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="会话菜单">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => agPrefs.togglePin(k)}>
              {pinned ? <PinOff /> : <Pin />}
              {pinned ? "取消置顶" : "置顶"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => agPrefs.toggleSettle(k)}>
              <Archive />
              {settled ? "取消归档" : "归档"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(location.origin + location.pathname + sessionLink(host, row.id)).then(() => toast.success("已复制会话链接"))}>复制链接</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setRenaming(true)}>重命名</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act("session/resume", { sid: row.id }, undefined)}>恢复 (重新载入)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act("session/close", { sid: row.id })}>结束 (留档)</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </ItemActions>
      )}
      {renaming && <RenameDialog title={row.title} onClose={() => setRenaming(false)} onSave={(title) => c.c.hx<SessionInfo>("session/rename", { sid: row.id, title }).then(() => c.c.putSession({ ...(row as SessionInfo), title }))} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="删除会话?"
        description={`"${row.title || "未命名"}" 的记录会从主机上删掉, 不能恢复。`}
        confirmLabel="删除"
        tone="destructive"
        onConfirm={() =>
          c.c.hx("session/delete", { sid: row.id }).then(() => {
            c.c.dropSession(row.id);
            agPrefs.forget(k);
          })
        }
      />
    </Item>
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
