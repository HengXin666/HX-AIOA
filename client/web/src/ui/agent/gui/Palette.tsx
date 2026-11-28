import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@hx/ui/ui/command";
import { Activity, Archive, BookOpen, Copy, FileDiff, FolderTree, Inbox, Keyboard, PanelLeft, PanelRight, Pin, Plus, Server, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useAgHub, useConnsVersion, usePairs } from "../../../agentgui/hooks";
import { knownConn } from "../../../agentgui/conns";
import { formatKey, keyFor, type Command } from "../../../agentgui/keybindings";
import { allPairs } from "../../../agentgui/pairs";
import { agPrefs, key, useAgPrefs } from "../../../agentgui/prefs";
import { ago, AgentGlyph, basename, DIAG, GUIDE, guiLink, INBOX, SETTINGS, sessionLink, StateDot } from "./parts";

type Action = { cmd?: Command; label: string; icon: ReactNode; run: () => void; session?: boolean };
type Row = { host: string; id: string; title: string; agent: string; state: string; updated: number; cwd?: string };

// 工作台命令面板 (mod+k): 跨主机搜会话, 跑命令; 与 t3code 一样会话优先, 置顶在前, 归档在后
export function Palette({ open, onOpenChange, inSession, run, onHost }: { open: boolean; onOpenChange: (v: boolean) => void; inSession: boolean; run: (c: Command) => void; onHost: (h: string) => void }) {
  usePairs();
  useConnsVersion();
  useAgPrefs();
  const hub = useAgHub();
  const close = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  const hosts = [...new Set([...allPairs().map((p) => p.host), ...hub.hosts.map((h) => h.subject)])];
  const rows: Row[] = hosts.flatMap((h) => {
    const direct = knownConn(h)?.snapshot().sessions ?? [];
    const list = direct.length ? direct : (hub.hosts.find((x) => x.subject === h)?.sessions ?? []);
    return list.map((s) => ({ host: h, id: s.id, title: s.title, agent: s.agent, state: s.state, updated: s.updated, cwd: (s as { cwd?: string }).cwd }));
  });
  const rank = (r: Row) => (agPrefs.pinned(key(r.host, r.id)) ? 0 : agPrefs.settled(key(r.host, r.id)) ? 2 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || b.updated - a.updated);

  const actions: Action[] = [
    { cmd: "chat.new", label: "新会话", icon: <Plus />, run: () => run("chat.new") },
    { cmd: "sidebar.toggle", label: "收起 / 展开左栏", icon: <PanelLeft />, run: () => run("sidebar.toggle") },
    { cmd: "rightPanel.toggle", label: "收起 / 展开右栏", icon: <PanelRight />, run: () => run("rightPanel.toggle"), session: true },
    { cmd: "diff.toggle", label: "打开改动", icon: <FileDiff />, run: () => run("diff.toggle"), session: true },
    { cmd: "filePicker.toggle", label: "打开文件", icon: <FolderTree />, run: () => run("filePicker.toggle"), session: true },
    { cmd: "thread.pin", label: "置顶 / 取消置顶当前会话", icon: <Pin />, run: () => run("thread.pin"), session: true },
    { cmd: "thread.settle", label: "归档 / 取消归档当前会话", icon: <Archive />, run: () => run("thread.settle"), session: true },
    { cmd: "thread.copyReference", label: "复制会话链接", icon: <Copy />, run: () => run("thread.copyReference"), session: true },
    { label: "审批模式 (收件箱)", icon: <Inbox />, run: () => (location.hash = guiLink(INBOX)) },
    { label: "设置: Agent 实例 · 设备 · 配对", icon: <Settings />, run: () => (location.hash = guiLink(SETTINGS)) },
    { label: "本地诊断", icon: <Activity />, run: () => (location.hash = guiLink(SETTINGS, DIAG)) },
    { label: "使用指引", icon: <BookOpen />, run: () => (location.hash = guiLink(GUIDE)) },
    { cmd: "shortcuts.open", label: "快捷键一览", icon: <Keyboard />, run: () => run("shortcuts.open") },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="命令面板" description="搜会话, 跑命令" className="sm:max-w-xl">
      <CommandInput placeholder="搜会话或命令" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>没有匹配的结果</CommandEmpty>
        {rows.length > 0 && (
          <CommandGroup heading="会话">
            {rows.map((r) => {
              const k = key(r.host, r.id);
              return (
                <CommandItem key={k} value={`s ${r.title} ${r.agent} ${r.host} ${r.cwd ?? ""} ${k}`} onSelect={close(() => (location.hash = sessionLink(r.host, r.id)))}>
                  <StateDot state={r.state} />
                  <span className="min-w-0 flex-1 truncate">{r.title || "未命名"}</span>
                  {agPrefs.pinned(k) && <Pin className="text-muted-foreground" />}
                  {agPrefs.settled(k) && <Archive className="text-muted-foreground" />}
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <AgentGlyph name={r.agent} />
                    {hosts.length > 1 ? `${r.host} · ` : ""}
                    {r.cwd ? `${basename(r.cwd)} · ` : ""}
                    {ago(r.updated)}前
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        <CommandGroup heading="命令">
          {actions
            .filter((a) => !a.session || inSession)
            .map((a) => (
              <CommandItem key={a.label} value={`c ${a.label}`} onSelect={close(a.run)}>
                {a.icon}
                {a.label}
                {a.cmd && keyFor(a.cmd) && <CommandShortcut>{formatKey(keyFor(a.cmd) as string).join(" ")}</CommandShortcut>}
              </CommandItem>
            ))}
        </CommandGroup>
        {hosts.length > 1 && (
          <CommandGroup heading="切换主机">
            {hosts.map((h) => (
              <CommandItem key={h} value={`h ${h}`} onSelect={close(() => onHost(h))}>
                <Server />
                {h}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
