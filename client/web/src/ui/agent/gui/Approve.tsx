import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Kbd } from "@hx/ui/ui/kbd";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HOLD_MS, KIND_LABEL, OPT_ALLOW_ALWAYS, OPT_ALLOW_ONCE, OPT_REJECT_ONCE, RISK_LABEL, TXT_ALLOW_ALWAYS, TXT_ALLOW_ONCE, TXT_REJECT } from "../../../agentgui/constants";
import type { Card, PermOption } from "../../../agentgui/types";
import { basename } from "./parts";

const RISK_DOT = { low: "success", mid: "warning", high: "destructive" } as const;
export const optionOf = (c: Card, kind: string): PermOption | undefined => c.options.find((o) => o.kind === kind);
export const isAllow = (o: PermOption): boolean => o.kind.startsWith("allow");

export function RiskBadge({ risk }: { risk: Card["risk"] }) {
  return (
    <Badge variant="outline" dot={RISK_DOT[risk]}>
      {RISK_LABEL[risk] ?? risk}
    </Badge>
  );
}

function Q({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{q}</span>
      {children}
    </div>
  );
}

// 一张卡回答四问的前三问 (动作, 为什么, 影响); 第四问 (怎么答) 由外层放按钮
export function CardQuestions({ card, compact = false }: { card: Card; compact?: boolean }) {
  const action = card.tool.title || KIND_LABEL[card.tool.kind] || card.tool.kind;
  return (
    <div className={`flex flex-col ${compact ? "gap-2" : "gap-4"}`}>
      <Q q="它想干什么">
        <p className="text-sm font-medium text-foreground">{action}</p>
        {card.tool.content && <pre className={`overflow-auto rounded-lg bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground ${compact ? "max-h-28" : "max-h-60"}`}>{card.tool.content}</pre>}
        {card.tool.locations.length > 0 && <p className="truncate font-mono text-xs text-muted-foreground">{card.tool.locations.join(", ")}</p>}
      </Q>
      {!compact && (
        <Q q="为什么">
          {card.goal && <p className="line-clamp-2 text-sm text-foreground">你: {card.goal}</p>}
          {card.last && <p className="line-clamp-3 text-sm text-muted-foreground">{card.agent}: {card.last}</p>}
        </Q>
      )}
      <Q q="影响多大">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <RiskBadge risk={card.risk} />
          {card.why.map((w) => (
            <span key={w}>{w}</span>
          ))}
          <span className="font-mono">
            {basename(card.cwd)}
            {card.branch ? ` · ${card.branch}` : ""}
          </span>
          {card.changed > 0 && <span>本轮已改 {card.changed} 个文件</span>}
        </div>
      </Q>
    </div>
  );
}

// 高风险: 长按 1 秒才算数, 防手滑
export function HoldButton({ onDone, children, disabled, className = "" }: { onDone: () => void; children: ReactNode; disabled?: boolean; className?: string }) {
  const [p, setP] = useState(0);
  const raf = useRef(0);
  const t0 = useRef(0);
  const stop = () => {
    cancelAnimationFrame(raf.current);
    setP(0);
  };
  const tick = () => {
    const v = Math.min(1, (performance.now() - t0.current) / HOLD_MS);
    setP(v);
    if (v >= 1) {
      stop();
      onDone();
    } else raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return (
    <Button
      size="lg"
      variant="outline"
      disabled={disabled}
      className={`relative overflow-hidden border-destructive text-destructive ${className}`}
      onPointerDown={() => {
        t0.current = performance.now();
        raf.current = requestAnimationFrame(tick);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => e.key === " " && !e.repeat && ((t0.current = performance.now()), (raf.current = requestAnimationFrame(tick)))}
      onKeyUp={stop}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 bg-destructive/15" style={{ width: `${p * 100}%` }} />
      <span className="relative">{children}</span>
    </Button>
  );
}

const editable = (el: EventTarget | null): el is HTMLElement => el instanceof HTMLElement && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);

// 工作模式的审批卡: 贴在输入框上方; Enter 允许一次, Shift+Enter 总是允许, Esc 拒绝
export function WorkPermCard({ card, more, busy, onAnswer }: { card: Card; more: number; busy: boolean; onAnswer: (option: string | null) => void }) {
  const once = optionOf(card, OPT_ALLOW_ONCE);
  const always = optionOf(card, OPT_ALLOW_ALWAYS);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (busy || e.isComposing) return;
      const t = e.target;
      // 输入框里有字时 Enter 归输入框 (拒绝并说明)
      if (editable(t) && (t as HTMLTextAreaElement).value?.trim()) return;
      if (editable(t) && t.tagName === "INPUT") return;
      if (e.key === "Enter" && !e.shiftKey && once && card.risk !== "high") {
        e.preventDefault();
        onAnswer(once.optionId);
      } else if (e.key === "Enter" && e.shiftKey && always && card.risk !== "high") {
        e.preventDefault();
        onAnswer(always.optionId);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onAnswer(null);
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [card, once, always, busy, onAnswer]);
  const high = card.risk === "high";
  return (
    <div className={`mx-auto mb-2 w-full max-w-[768px] rounded-xl border bg-card p-3 shadow-sm ${high ? "border-destructive" : "border-warning"}`} role="alertdialog" aria-label="审批">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">等你批准</span>
        <RiskBadge risk={card.risk} />
        {more > 0 && <span className="text-xs text-muted-foreground">还有 {more} 个</span>}
      </div>
      <CardQuestions card={card} compact />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {card.options.filter((o) => o.kind !== OPT_REJECT_ONCE).map((o) => {
          const kbd = o === once ? "Enter" : o === always ? "Shift+Enter" : null;
          const label = o === once ? TXT_ALLOW_ONCE : o === always ? TXT_ALLOW_ALWAYS : o.name;
          if (high && isAllow(o))
            return (
              <HoldButton key={o.optionId} disabled={busy} onDone={() => onAnswer(o.optionId)}>
                长按 {label}
              </HoldButton>
            );
          return (
            <Button key={o.optionId} size="sm" variant={o === once ? "default" : "outline"} disabled={busy} onClick={() => onAnswer(o.optionId)}>
              {label}
              {kbd && !high && <Kbd>{kbd}</Kbd>}
            </Button>
          );
        })}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAnswer(null)}>
          {TXT_REJECT} <Kbd>Esc</Kbd>
        </Button>
        <span className="text-xs text-muted-foreground">或直接打字 = 拒绝并说明</span>
      </div>
    </div>
  );
}
