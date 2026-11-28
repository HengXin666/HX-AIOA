import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { CopyField } from "@hx/ui/ui/copy-field";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@hx/ui/ui/sheet";
import { ExternalLink, MessageSquare } from "lucide-react";
import { useLayout } from "../../app/hooks";
import { nav } from "../../app/router";
import { EXTERNAL } from "../../core/constants";
import { shortTime } from "../ChatList";
import type { Row } from "./items";
import { TONE, tint } from "./parts";

// 事件详情 (对照安卓 EventSheet / MailPeek): 全文, 验证码, 关键信息, 链接; 去所在的群定位到这一条
const TONE_LABEL = { danger: "严重", warning: "注意", success: "已恢复", info: "报告", primary: "动态", accent: "动态", muted: "动态" } as const;

export function EventSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const narrow = useLayout() === "narrow";
  const r = row;
  const full = r && r.ev.kind !== "metric" ? ((r.ev as { data?: { summary?: string; markdown?: string } }).data ?? {}) : {};
  const body = full.markdown ?? full.summary;
  return (
    <Sheet open={Boolean(r)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side={narrow ? "bottom" : "right"} className={narrow ? "max-h-[85vh]" : "w-[440px] sm:max-w-[440px]"}>
        {r && (
          <>
            <SheetHeader className="gap-2">
              <Badge variant="outline" className="self-start" style={{ color: TONE[r.tone], background: tint(TONE[r.tone], 10) }}>
                {TONE_LABEL[r.tone]}
              </Badge>
              <SheetTitle className="text-lg leading-snug">{r.title}</SheetTitle>
              <SheetDescription>
                {r.source} · {shortTime(r.ts)}
                {r.count > 1 ? ` · 合并了 ${r.count} 条` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
              {r.code && <CopyField label={r.codeNote ?? "验证码"} value={r.code} size="lg" clickToCopy />}
              {r.mail?.facts?.length ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  {r.mail.facts.map((f) => (
                    <div key={f.label} className="contents">
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd className="text-foreground">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {body && <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">{body}</p>}
              {r.mail?.links?.length ? (
                <div className="flex flex-wrap gap-2">
                  {r.mail.links.map((l) => (
                    <Button key={l.url} asChild size="sm" variant="outline">
                      <a href={l.url} {...EXTERNAL}>
                        <ExternalLink />
                        {l.label}
                      </a>
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            <SheetFooter className="flex-row justify-end gap-2">
              {r.url && (
                <Button asChild variant="outline">
                  <a href={r.url} {...EXTERNAL}>
                    <ExternalLink />
                    打开链接
                  </a>
                </Button>
              )}
              {r.group && (
                <Button
                  onClick={() => {
                    onClose();
                    nav("chat", r.group!, String(r.ev.seq));
                  }}
                >
                  <MessageSquare />
                  去群里看
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
