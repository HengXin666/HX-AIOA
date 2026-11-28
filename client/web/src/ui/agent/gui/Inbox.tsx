import { Button } from "@hx/ui/ui/button";
import { Card as Panel } from "@hx/ui/ui/card";
import { Textarea } from "@hx/ui/ui/textarea";
import { ChevronLeft, ChevronRight, Inbox as InboxIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OPT_ALLOW_ALWAYS, OPT_ALLOW_ONCE, STATE_LABEL, STORAGE_AG_MODE, TXT_ALLOW_ALWAYS, TXT_ALLOW_ONCE, TXT_REJECT_SAY, TXT_SEE_ALL, TXT_SEND_FAIL } from "../../../agentgui/constants";
import { useAgHub } from "../../../agentgui/hooks";
import { agHub, cardKey } from "../../../agentgui/hub";
import type { Card } from "../../../agentgui/types";
import { CardQuestions, HoldButton, optionOf } from "./Approve";
import { ago, basename, ModeToggle, pct, sessionLink, StateDot, useNow } from "./parts";

const ACTIVE = new Set(["starting", "running", "waiting"]);
const toWork = () => localStorage.setItem(STORAGE_AG_MODE, "work");

// 同会话的挤在一起只露最前一张; 整体按 "Agent 因此停了多久" 排
function order(cards: Card[]): { card: Card; same: number }[] {
  const bySession = new Map<string, Card[]>();
  for (const c of [...cards].sort((a, b) => a.at - b.at)) {
    const k = `${c.host}/${c.sid}`;
    bySession.set(k, [...(bySession.get(k) ?? []), c]);
  }
  return [...bySession.values()].map((l) => ({ card: l[0] as Card, same: l.length - 1 }));
}

// 审批模式: 一屏一张卡, 10 秒内做对一个决定
export function Inbox() {
  const hub = useAgHub();
  const now = useNow();
  const list = order(hub.cards);
  const [i, setI] = useState(0);
  const [say, setSay] = useState<string | null>(null);
  const idx = Math.min(i, Math.max(0, list.length - 1));
  const cur = list[idx];
  const busy = cur ? Boolean(hub.answering[cardKey(cur.card)]) : false;

  const answer = (option: string | null, text = "") => {
    if (!cur) return;
    if (!agHub.answer(cur.card, option, text)) return void toast.error(TXT_SEND_FAIL);
    setSay(null);
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (say !== null || !cur || busy) return;
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, list.length - 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      else if (e.key === "Enter" && cur.card.risk !== "high") {
        const o = optionOf(cur.card, e.shiftKey ? OPT_ALLOW_ALWAYS : OPT_ALLOW_ONCE);
        if (o) answer(o.optionId);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const active = hub.hosts.flatMap((h) => h.sessions.filter((s) => ACTIVE.has(s.state)).map((s) => ({ ...s, host: h.subject })));

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="flex-1 text-base font-semibold text-foreground">审批{list.length ? ` (${hub.cards.length})` : ""}</h2>
        <ModeToggle mode="approve" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
          {!cur ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground [&_svg]:size-10">
              <InboxIcon />
              <p className="text-sm">{hub.loaded ? "没有等你决定的事" : "加载中"}</p>
              {hub.err && <p className="text-xs text-destructive">{hub.err}</p>}
            </div>
          ) : (
            <Panel className={`flex flex-col gap-4 p-5 ${cur.card.risk === "high" ? "border-destructive" : ""}`}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate font-medium text-foreground">{cur.card.agent}</span>
                <span>· {basename(cur.card.cwd)}</span>
                <span>· 等了 {ago(cur.card.at, now)}</span>
                <span className="flex-1" />
                {hub.cards.length > 1 && <span>还有 {hub.cards.length - 1} 个</span>}
                <Button size="icon-xs" variant="ghost" aria-label="上一张" disabled={idx === 0} onClick={() => setI(idx - 1)}>
                  <ChevronLeft />
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label="下一张" disabled={idx >= list.length - 1} onClick={() => setI(idx + 1)}>
                  <ChevronRight />
                </Button>
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {cur.card.title}
                {cur.same > 0 ? ` · 这个会话还有 ${cur.same} 个` : ""}
              </p>
              <CardQuestions card={cur.card} />
              <Answer card={cur.card} busy={busy} say={say} setSay={setSay} onAnswer={answer} />
            </Panel>
          )}
          {active.length > 0 && (
            <section aria-label="进行中">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">进行中</h3>
              <ul className="flex flex-col">
                {active.map((s) => (
                  <li key={`${s.host}/${s.id}`}>
                    <a href={sessionLink(s.host, s.id)} onClick={toWork} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted">
                      <StateDot state={s.state} />
                      <span className="min-w-0 flex-1 truncate text-foreground">{s.title || s.id}</span>
                      <span className="text-xs text-muted-foreground">{STATE_LABEL[s.state]}</span>
                      {s.ctx !== undefined && <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{pct(s.ctx)}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// 第四问: 大按钮允许一次 (高风险长按), 次按钮总是允许 / 拒绝并说明, 链接看全部
function Answer({ card, busy, say, setSay, onAnswer }: { card: Card; busy: boolean; say: string | null; setSay: (v: string | null) => void; onAnswer: (o: string | null, text?: string) => void }) {
  const once = optionOf(card, OPT_ALLOW_ONCE);
  const always = optionOf(card, OPT_ALLOW_ALWAYS);
  const rest = card.options.filter((o) => o !== once && o !== always && !o.kind.startsWith("reject"));
  const high = card.risk === "high";
  if (say !== null)
    return (
      <div className="flex flex-col gap-2">
        <Textarea autoFocus rows={3} value={say} onChange={(e) => setSay(e.target.value)} placeholder="告诉 Agent 为什么不行, 或换个做法" aria-label="拒绝的理由" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSay(null)}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => onAnswer(null, say.trim())}>
            拒绝{say.trim() ? "并说明" : ""}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      {once &&
        (high ? (
          <HoldButton className="w-full" disabled={busy} onDone={() => onAnswer(once.optionId)}>
            长按 1 秒 {TXT_ALLOW_ONCE}
          </HoldButton>
        ) : (
          <Button size="lg" className="w-full" disabled={busy} onClick={() => onAnswer(once.optionId)}>
            {busy ? "已发出" : TXT_ALLOW_ONCE}
          </Button>
        ))}
      <div className="grid grid-cols-2 gap-2">
        {always && (
          <Button variant="outline" disabled={busy} onClick={() => onAnswer(always.optionId)}>
            {TXT_ALLOW_ALWAYS}
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => setSay("")} className={always ? "" : "col-span-2"}>
          {TXT_REJECT_SAY}
        </Button>
      </div>
      {rest.map((o) => (
        <Button key={o.optionId} variant="ghost" disabled={busy} onClick={() => onAnswer(o.optionId)}>
          {o.name}
        </Button>
      ))}
      <a href={sessionLink(card.host, card.sid)} onClick={toWork} className="self-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        {TXT_SEE_ALL}
      </a>
    </div>
  );
}
