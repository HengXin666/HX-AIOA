import { useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_AG_HOST, STORAGE_AG_RIGHT } from "../../../agentgui/constants";
import { conn, knownConn, startConns } from "../../../agentgui/conns";
import { useAgHub, useConn, useConnsVersion, usePairs } from "../../../agentgui/hooks";
import { allPairs } from "../../../agentgui/pairs";
import { BP_WIDE } from "../../../core/constants";
import type { AreaProps } from "../../Shell";
import { Ctx, type GuiCtx, type RightTab } from "./ctx";
import { Inbox } from "./Inbox";
import { NewSession } from "./NewSession";
import { guiLink, guiMode, INBOX, ModeToggle, SETTINGS, sessionLink } from "./parts";
import { RightPane } from "./RightPane";
import { SessionView } from "./Session";
import { SettingsPage } from "./Settings";
import { Sidebar } from "./Sidebar";
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

// Agent GUI 工作台: #/agent/gui (新会话), #/agent/gui/<主机>/<会话>, #/agent/gui/inbox (审批), #/agent/gui/settings
export default function AgentGui({ loc }: AreaProps) {
  const ok = useBoot();
  const hub = useAgHub();
  useConnsVersion();
  // 直连会话里的待审批 (Hub 不可达时也要计数) 与 Hub 收件箱取大的
  const direct = allPairs().reduce((n, p) => n + (knownConn(p.host)?.snapshot().sessions.reduce((m, s) => m + (s.pending || 0), 0) ?? 0), 0);
  useTitleCount(Math.max(hub.cards.length, direct));
  const path = loc.path.slice(1);
  const page = path[0] === INBOX ? "inbox" : path[0] === SETTINGS ? "settings" : path.length >= 2 ? "session" : "new";

  // 从 Agent 栏首页进来时按上次的模式开
  useEffect(() => {
    if (page === "new" && guiMode() === "approve") location.replace(guiLink(INBOX));
  }, [page]);

  if (!ok) return null;
  if (page === "inbox") return <Inbox />;
  return <Workbench page={page} routeHost={page === "session" ? path[0] : undefined} sid={page === "session" ? path[1] : undefined} />;
}

function useWide(): boolean {
  const [w, setW] = useState(() => window.innerWidth >= BP_WIDE);
  useEffect(() => {
    const q = matchMedia(`(min-width: ${BP_WIDE}px)`);
    const on = () => setW(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return w;
}

function Workbench({ page, routeHost, sid }: { page: "new" | "settings" | "session"; routeHost?: string; sid?: string }) {
  usePairs();
  const hub = useAgHub();
  const [picked, setPicked] = useState(() => localStorage.getItem(STORAGE_AG_HOST) ?? "");
  const fallback = allPairs()[0]?.host ?? hub.hosts[0]?.subject ?? "";
  const host = routeHost ?? (picked || fallback);
  const wide = useWide();
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
    }),
    [host, sid, c.c, wide],
  );

  useShortcuts(host, sid, c.sessions.map((s) => s.id));

  return (
    <Ctx.Provider value={ctx}>
      <div className="relative flex h-full min-h-0 w-full">
        <Sidebar host={host} sid={sid} onHost={onHost} />
        <main className="flex min-w-0 flex-1 flex-col">
          {page === "session" && sid ? (
            <SessionView key={`${host}/${sid}`} right={showRight} toggleRight={toggleRight} draft={draft} />
          ) : (
            <>
              <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
                <h2 className="flex-1 text-sm font-semibold text-foreground">{page === "settings" ? "设置" : "新会话"}</h2>
                <ModeToggle mode="work" />
              </header>
              {page === "settings" ? <SettingsPage host={host} /> : <NewSession host={host} onHost={onHost} />}
            </>
          )}
        </main>
        {showRight && sid && (
          <aside className={`flex h-full w-[400px] shrink-0 flex-col border-l border-border bg-background ${wide ? "" : "absolute inset-y-0 right-0 z-20 shadow-lg"}`}>
            <RightBody host={host} sid={sid} tab={rightTab} setTab={setRightTab} path={rightPath} onClose={toggleRight} />
          </aside>
        )}
      </div>
    </Ctx.Provider>
  );
}

function RightBody({ host, sid, tab, setTab, path, onClose }: { host: string; sid: string; tab: RightTab; setTab: (t: RightTab) => void; path?: string; onClose: () => void }) {
  const s = useSession(host, sid);
  return <RightPane tab={tab} setTab={setTab} path={path} view={s.view} onClose={onClose} />;
}

// Ctrl+N 新会话, Ctrl+[ / Ctrl+] 上下一个会话
function useShortcuts(host: string, sid: string | undefined, ids: string[]): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        location.hash = guiLink();
      } else if ((e.key === "[" || e.key === "]") && ids.length) {
        e.preventDefault();
        const i = sid ? ids.indexOf(sid) : -1;
        const next = ids[(i + (e.key === "]" ? 1 : ids.length - 1) + ids.length) % ids.length];
        if (next) location.hash = sessionLink(host, next);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [host, sid, ids]);
}
