import { Button } from "@hx/ui/ui/button";
import { PanelRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TXT_AUTH_FAIL, TXT_NO_ROUTE, TXT_SEND_FAIL, TXT_UNPAIRED } from "../../../agentgui/constants";
import { useAgHub, useAttach, useConn, useSession } from "../../../agentgui/hooks";
import { agHub } from "../../../agentgui/hub";
import { modelPicker, nameOf } from "../../../agentgui/options";
import { agPrefs, key } from "../../../agentgui/prefs";
import type { Card, ContentBlock } from "../../../agentgui/types";
import { WorkPermCard } from "./Approve";
import { Composer } from "./Composer";
import { useGui } from "./ctx";
import { LoginCard } from "./Login";
import { ApproveOnly, guiLink, INBOX, ModeToggle, ReconnectBar, RouteBadge } from "./parts";
import { StatsBar } from "./StatsBar";
import { SidebarButton } from "./layout";
import { Timeline } from "./Timeline";

// 会话页 (工作模式): 顶栏, 时间线, 贴在输入框上方的审批卡, 输入框, 统计条
export function SessionView({ right, toggleRight, draft }: { right: boolean; toggleRight: () => void; draft: React.MutableRefObject<((t: string) => void) | null> }) {
  const { host, sid, cmd } = useGui();
  const c = useConn(host);
  const s = useSession(host, sid);
  const hub = useAgHub();
  useAttach(host, sid);
  const info = c.sessions.find((x) => x.id === sid);
  const [modelOpen, setModelOpen] = useState(false);
  const queue = useRef<ContentBlock[][]>([]);

  const perms = useMemo(() => {
    const seen = new Set(s.perms.map((p) => p.rid));
    const viaHub = hub.cards.filter((x) => x.host === host && x.sid === sid && !seen.has(x.rid));
    return [...s.perms, ...viaHub].sort((a, b) => a.at - b.at);
  }, [s.perms, hub.cards, host, sid]);
  const perm = perms[0];
  const last = s.view.turns[s.view.turns.length - 1];
  // 有轮次时以 ACP 的轮为准, 会话状态只在还没回放时兜底
  const running = last ? last.running : info?.state === "running" || info?.state === "starting";
  const ready = c.state === "ready";

  const send = (prompt: ContentBlock[]) => {
    if (running) {
      queue.current.push(prompt);
      toast.info("已排队, 这一轮结束后发出");
      return;
    }
    c.c.acpRequest(sid, "session/prompt", { prompt }).catch((e: Error) => toast.error(e.message));
  };

  // 打开着就算看过; mod+shift+m 开模型面板
  useEffect(() => {
    if (info?.updated) agPrefs.markSeen(key(host, sid), info.updated);
  }, [host, sid, info?.updated]);
  useEffect(() => cmd.on((k) => k === "modelPicker.toggle" && setModelOpen((v) => !v)), [cmd]);

  // 排队的话在这一轮结束后逐条发
  useEffect(() => {
    if (running || queue.current.length === 0 || !ready) return;
    const next = queue.current.shift() as ContentBlock[];
    c.c.acpRequest(sid, "session/prompt", { prompt: next }).catch((e: Error) => toast.error(e.message));
  }, [running, ready, c.c, sid]);

  const answer = (card: Card, option: string | null, text = "") => {
    const ok = ready && s.perms.some((p) => p.rid === card.rid) ? c.c.perm(sid, card.rid, option, text) : agHub.answer(card, option, text);
    if (!ok) toast.error(TXT_SEND_FAIL);
  };

  const retry = () => {
    const prev = [...s.view.turns].reverse().find((t) => t.user);
    if (prev?.user?.length) send(prev.user);
  };

  const model = nameOf(modelPicker(s.view, info));
  const title = s.view.title || info?.title || "会话";
  const approveOnly = c.state === "noroute" || c.state === "unreachable";
  const blocked = c.state === "unpaired" ? TXT_UNPAIRED : approveOnly ? c.err || TXT_NO_ROUTE : c.state === "auth" || c.state === "changed" ? c.err || TXT_AUTH_FAIL : "";
  const login = c.login && (c.login.sid === sid || (!c.login.sid && (!c.login.instance || c.login.instance === info?.instance))) ? c.login : null;
  const inst = c.instances.find((i) => i.id === (login?.instance || info?.instance));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
        <SidebarButton />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{[info?.agent, model, info?.branch ? `分支 ${info.branch}` : "", info?.cwd].filter(Boolean).join(" · ")}</p>
        </div>
        <RouteBadge route={c.route} state={c.state} />
        <ModeToggle mode="work" />
        <Button size="icon-sm" variant={right ? "secondary" : "ghost"} aria-label="右栏" aria-pressed={right} onClick={toggleRight}>
          <PanelRight />
        </Button>
      </header>
      <ReconnectBar state={c.state} />
      {blocked && s.view.turns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          {approveOnly ? <ApproveOnly text={blocked} n={perms.length} onRetry={c.state === "unreachable" ? () => c.c.kick() : undefined} /> : <p>{blocked}</p>}
          {!approveOnly && perms.length > 0 && (
            <Button asChild>
              <a href={guiLink(INBOX)}>去审批模式处理 {perms.length} 个请求</a>
            </Button>
          )}
        </div>
      ) : (
        <Timeline snap={s} onRetry={retry} onModel={() => setModelOpen(true)} />
      )}
      <div className={`shrink-0 px-4 pb-2 ${c.stale ? "opacity-80" : ""}`}>
        {login && <LoginCard conn={c.c} login={login} instance={inst} onDone={retry} />}
        {perm && <WorkPermCard card={perm} more={perms.length - 1} busy={Boolean(s.answering[perm.rid] || hub.answering[`${host}/${perm.rid}`])} onAnswer={(o) => answer(perm, o)} />}
        <Composer
          view={s.view}
          info={info}
          running={running}
          rejecting={Boolean(perm)}
          disabled={ready ? undefined : blocked || "未连上主机, 连上后可以继续"}
          modelOpen={modelOpen}
          setModelOpen={setModelOpen}
          onSend={send}
          onStop={() => c.c.acpNotify(sid, "session/cancel", {}) || toast.error(TXT_SEND_FAIL)}
          onRejectSay={(t) => perm && answer(perm, null, t)}
          draftRef={draft}
        />
        <StatsBar stats={s.stats} usage={s.view.usage} last={[...s.view.turns].reverse().find((t) => !t.running)} />
      </div>
    </div>
  );
}
