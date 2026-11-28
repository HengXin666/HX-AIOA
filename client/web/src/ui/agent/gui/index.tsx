import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { matchCommand, type Command } from "../../../agentgui/keybindings";
import { useTurnNotify } from "../../../agentgui/notify";
import { agPrefs, key as prefKey, useAgPrefs } from "../../../agentgui/prefs";
import { Emitter } from "../../../core/emitter";
import { ShortcutsDialog } from "./Keys";
import { Palette } from "./Palette";
import { STORAGE_AG_HOST, STORAGE_AG_RIGHT } from "../../../agentgui/constants";
import { conn, knownConn, startConns } from "../../../agentgui/conns";
import { useAgHub, useConn, useConnsVersion, useInbox, usePairs } from "../../../agentgui/hooks";
import { allPairs } from "../../../agentgui/pairs";
import { BP_MID } from "../../../core/constants";
import type { AreaProps } from "../../Shell";
import { Ctx, type GuiCtx, type RightTab } from "./ctx";
import { SidebarButton, useWide } from "./layout";
import { Inbox } from "./Inbox";
import { NewSession } from "./NewSession";
import { GuidePage } from "./Guide";
import { GUIDE, guiLink, guiMode, INBOX, ModeToggle, SETTINGS, sessionLink } from "./parts";
import { RightPane } from "./RightPane";
import { SessionView } from "./Session";
import { SettingsPage } from "./Settings";
import { SEARCH_ID, Sidebar } from "./Sidebar";
import { useSession } from "../../../agentgui/hooks";

let booted: Promise<void> | null = null;
// dev 下可挂一台内存模拟主机 (设置里开), 生产包不带 dev-mock
function boot(): Promise<void> {
  booted ??= (async () => {
    if (import.meta.env.DEV) {
      const m = await import("../../../agentgui/dev-mock");
      if (m.mockWanted()) m.installMock();
    }
  })();
  return booted;
}

function useBoot(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let live = true;
    void boot().then(() => {
      if (!live) return;
      stop = startConns();
      setOk(true);
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return ok;
}

// 等你: 页标题前加 (n)
function useTitleCount(n: number): void {
  const base = useRef(document.title.replace(/^\(\d+\)\s*/, ""));
  useEffect(() => {
    document.title = n > 0 ? `(${n}) ${base.current}` : base.current;
  }, [n]);
  useEffect(() => () => void (document.title = base.current), []);
}

// Agent GUI 工作台: #/agent/gui (新会话), #/agent/gui/<主机>/<会话>, #/agent/gui/inbox (审批), #/agent/gui/settings, #/agent/gui/guide (使用指引)
export default function AgentGui({ loc }: AreaProps) {
  const ok = useBoot();
  // 进 Agent GUI 才补拉收件箱
  const hub = useInbox();
  useConnsVersion();
  // 直连会话里的待审批 (Hub 不可达时也要计数) 与 Hub 收件箱取大的
  const direct = allPairs().reduce((n, p) => n + (knownConn(p.host)?.snapshot().sessions.reduce((m, s) => m + (s.pending || 0), 0) ?? 0), 0);
  useTitleCount(Math.max(hub.cards.length, direct));
  const path = loc.path.slice(1);
  const page = path[0] === INBOX ? "inbox" : path[0] === SETTINGS ? "settings" : path[0] === GUIDE ? "guide" : path.length >= 2 ? "session" : "new";

  // 从 Agent 栏首页进来时按上次的模式开
  useEffect(() => {
    if (page === "new" && guiMode() === "approve") location.replace(guiLink(INBOX));
  }, [page]);

  if (!ok) return null;
  if (page === "inbox") return <Inbox />;
  return <Workbench page={page} sub={path[1]} routeHost={page === "session" ? path[0] : undefined} sid={page === "session" ? path[1] : undefined} />;
}

function Workbench({ page, sub, routeHost, sid }: { page: "new" | "settings" | "guide" | "session"; sub?: string; routeHost?: string; sid?: string }) {
  usePairs();
  const prefs = useAgPrefs();
  const [palette, setPalette] = useState(false);
  const [keys, setKeys] = useState(false);
  const [cmd] = useState(() => new Emitter<Command>());
  useTurnNotify(sessionLink);
  const hub = useAgHub();
  const [picked, setPicked] = useState(() => localStorage.getItem(STORAGE_AG_HOST) ?? "");
  const fallback = allPairs()[0]?.host ?? hub.hosts[0]?.subject ?? "";
  const host = routeHost ?? (picked || fallback);
  const wide = useWide();
  // 窄屏: 左栏改成盖在上面的抽屉, 切会话后自动收起
  const narrow = !useWide(BP_MID);
  const [sheet, setSheet] = useState(false);
  useEffect(() => setSheet(false), [sid, page]);
  const [rightOn, setRightOn] = useState(localStorage.getItem(STORAGE_AG_RIGHT) !== "0");
  const [rightTab, setRightTab] = useState<RightTab>("changes");
  const [rightPath, setRightPath] = useState<string | undefined>();
  const [rightForced, setRightForced] = useState(false);
  const draft = useRef<((t: string) => void) | null>(null);
  const c = useConn(host);
  const showRight = page === "session" && (wide ? rightOn : rightForced);

  const onHost = (h: string) => {
    localStorage.setItem(STORAGE_AG_HOST, h);
    setPicked(h);
    conn(h).kick();
    if (page === "session") location.hash = guiLink();
  };
  const toggleRight = () => {
    if (!wide) return setRightForced(!rightForced);
    localStorage.setItem(STORAGE_AG_RIGHT, rightOn ? "0" : "1");
    setRightOn(!rightOn);
  };

  const ctx = useMemo<GuiCtx>(
    () => ({
      host,
      sid: sid ?? "",
      conn: c.c,
      openRight: (tab, p) => {
        setRightTab(tab);
        setRightPath(p);
        if (wide) setRightOn(true);
        else setRightForced(true);
      },
      insert: (t) => draft.current?.(t),
      cmd,
      toggleSidebar: () => (narrow ? setSheet((v) => !v) : agPrefs.toggleSidebar()),
    }),
    [host, sid, c.c, wide, cmd, narrow],
  );

  // 侧栏顺序: 置顶在前, 其余按最近; 上下一个与 mod+数字都按它走
  const order = [...c.sessions]
    .filter((s) => !agPrefs.settled(prefKey(host, s.id)) || s.id === sid)
    .sort((a, b) => Number(agPrefs.pinned(prefKey(host, b.id))) - Number(agPrefs.pinned(prefKey(host, a.id))) || b.updated - a.updated)
    .map((s) => s.id);
  const run = (k: Command) => {
    const go = (id?: string) => id && (location.hash = sessionLink(host, id));
    const at = sid ? order.indexOf(sid) : -1;
    if (k.startsWith("thread.jump.")) return go(order[Number(k.slice("thread.jump.".length)) - 1]);
    switch (k) {
      case "commandPalette.toggle":
        return setPalette((v) => !v);
      case "shortcuts.open":
        return setKeys(true);
      case "sidebar.toggle":
        return ctx.toggleSidebar();
      case "chat.new":
        return void (location.hash = guiLink());
      case "chat.find":
        if (narrow) setSheet(true);
        else if (prefs.sidebarOff) agPrefs.toggleSidebar();
        return void requestAnimationFrame(() => document.getElementById(SEARCH_ID)?.focus());
      case "rightPanel.toggle":
        return toggleRight();
      case "diff.toggle":
        return showRight && rightTab === "changes" ? toggleRight() : ctx.openRight("changes");
      case "filePicker.toggle":
        return ctx.openRight("files");
      case "thread.previous":
      case "thread.next":
        return order.length > 0 && go(order[(at + (k === "thread.next" ? 1 : order.length - 1) + order.length) % order.length]);
      case "thread.pin":
        return sid && agPrefs.togglePin(prefKey(host, sid));
      case "thread.settle":
        return sid && agPrefs.toggleSettle(prefKey(host, sid));
      case "thread.copyReference":
        return sid && void navigator.clipboard.writeText(location.origin + location.pathname + sessionLink(host, sid)).then(() => toast.success("已复制会话链接"));
      default:
        return cmd.emit(k);
    }
  };
  const runRef = useRef(run);
  runRef.current = run;
  useCommandKeys(page === "session", runRef);

  return (
    <Ctx.Provider value={ctx}>
      <div className="relative flex h-full min-h-0 w-full">
        {narrow ? (
          sheet && (
            <>
              <button type="button" aria-label="收起左栏" className="absolute inset-0 z-30 bg-black/40" onClick={() => setSheet(false)} />
              <div className="absolute inset-y-0 left-0 z-40 shadow-lg">
                <Sidebar host={host} sid={sid} onHost={onHost} />
              </div>
            </>
          )
        ) : (
          !prefs.sidebarOff && <Sidebar host={host} sid={sid} onHost={onHost} />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          {page === "session" && sid ? (
            <SessionView key={`${host}/${sid}`} right={showRight} toggleRight={toggleRight} draft={draft} />
          ) : (
            <>
              <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
                <SidebarButton />
                <h2 className="flex-1 text-sm font-semibold text-foreground">{page === "settings" ? "设置" : page === "guide" ? "使用指引" : "新会话"}</h2>
                <ModeToggle mode="work" />
              </header>
              {page === "settings" ? <SettingsPage host={host} focus={sub} /> : page === "guide" ? <GuidePage host={host} /> : <NewSession host={host} onHost={onHost} />}
            </>
          )}
        </main>
        {showRight && sid && (
          <aside className={`flex h-full w-[400px] shrink-0 flex-col border-l border-border bg-background ${wide ? "" : "absolute inset-y-0 right-0 z-20 shadow-lg"}`}>
            <RightBody host={host} sid={sid} tab={rightTab} setTab={setRightTab} path={rightPath} onClose={toggleRight} />
          </aside>
        )}
      </div>
      {palette && <Palette open={palette} onOpenChange={setPalette} inSession={page === "session"} run={run} onHost={onHost} />}
      <ShortcutsDialog open={keys} onOpenChange={setKeys} />
    </Ctx.Provider>
  );
}

function RightBody({ host, sid, tab, setTab, path, onClose }: { host: string; sid: string; tab: RightTab; setTab: (t: RightTab) => void; path?: string; onClose: () => void }) {
  const s = useSession(host, sid);
  return <RightPane tab={tab} setTab={setTab} path={path} view={s.view} onClose={onClose} />;
}

// 工作台快捷键: 捕获阶段先于全局的 Ctrl+K 命令面板, 认领了就不再往外传
function useCommandKeys(inSession: boolean, run: React.MutableRefObject<(c: Command) => void>): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const editable = Boolean(t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA"));
      const c = matchCommand(e, { inSession, editableFocus: editable, composerFocus: t?.getAttribute("aria-label") === "消息" });
      if (!c) return;
      e.preventDefault();
      e.stopPropagation();
      run.current(c);
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [inSession, run]);
}

