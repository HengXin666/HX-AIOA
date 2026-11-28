import { Button } from "@hx/ui/ui/button";
import { useState } from "react";
import { DIFF_PREVIEW_LINES } from "../../../agentgui/constants";
import type { DiffLine } from "../../../agentgui/reduce";

const ROW: Record<DiffLine["op"], string> = {
  "+": "bg-success/12 text-foreground",
  "-": "bg-destructive/12 text-foreground",
  " ": "text-muted-foreground",
};

// 红绿统一 diff; 默认前 40 行, 可展开
export function DiffView({ lines, limit = DIFF_PREVIEW_LINES, onOpen }: { lines: DiffLine[]; limit?: number; onOpen?: () => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, limit);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <pre className="max-h-[480px] overflow-auto py-1 font-mono text-xs leading-5">
        {shown.map((l, i) => (
          <div key={i} className={`flex px-2 ${l.text.startsWith("@@") && l.op === " " ? "bg-muted text-info" : ROW[l.op]}`}>
            <span className="w-4 shrink-0 select-none opacity-60">{l.op === " " ? "" : l.op}</span>
            <span className="whitespace-pre">{l.text || " "}</span>
          </div>
        ))}
      </pre>
      {(lines.length > limit || onOpen) && (
        <div className="flex items-center gap-2 border-t border-border px-2 py-1">
          {lines.length > limit && (
            <Button size="xs" variant="ghost" onClick={() => setAll(!all)}>
              {all ? "收起" : `展开全部 ${lines.length} 行`}
            </Button>
          )}
          {onOpen && (
            <Button size="xs" variant="ghost" onClick={onOpen}>
              在右栏打开
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function AddDel({ add, del }: { add: number; del: number }) {
  if (!add && !del) return null;
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      {add > 0 && <span className="text-success">+{add}</span>}
      {add > 0 && del > 0 && " "}
      {del > 0 && <span className="text-destructive">-{del}</span>}
    </span>
  );
}
