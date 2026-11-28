import { Button } from "@hx/ui/ui/button";
import { Input } from "@hx/ui/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@hx/ui/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { Check, Cpu } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useConn } from "../../../agentgui/hooks";
import { modelPicker, nameOf, pick, thoughtPicker } from "../../../agentgui/options";
import type { View } from "../../../agentgui/reduce";
import type { SessionInfo } from "../../../agentgui/types";
import { useGui } from "./ctx";
import { guiLink } from "./parts";

export const STORAGE_NEW_INSTANCE = "aioa.ag.newInstance";

// 模型面板: 上方 Agent 实例 (切实例 = 开新会话), 下方模型列表 (可搜) 与思考深度, 都来自 Agent 公布的配置
export function ModelPanel({ view, info, open, setOpen }: { view: View; info?: SessionInfo; open: boolean; setOpen: (v: boolean) => void }) {
  const { conn, sid, host } = useGui();
  const { instances } = useConn(host);
  const [q, setQ] = useState("");
  const model = modelPicker(view, info);
  const thought = thoughtPicker(view, info);
  const choose = (p: NonNullable<typeof model>, v: string) => void pick(conn, sid, p, v).catch((e: Error) => toast.error(e.message));
  const label = [nameOf(model), thought ? `思考 ${nameOf(thought)}` : ""].filter(Boolean).join(" · ") || "模型";
  const list = model?.choices.filter((c) => !q || `${c.name} ${c.value}`.toLowerCase().includes(q.toLowerCase())) ?? [];
  const switchTo = (id: string) => {
    localStorage.setItem(STORAGE_NEW_INSTANCE, id);
    setOpen(false);
    location.hash = guiLink();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" title="模型">
          <Cpu />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Agent 实例</p>
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          {instances.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => it.id !== info?.instance && switchTo(it.id)}
              className={`truncate rounded-lg border px-2 py-1.5 text-left text-xs ${it.id === info?.instance ? "border-primary text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
              title={it.id === info?.instance ? "当前实例" : "用这个实例开新会话"}
            >
              {it.name}
            </button>
          ))}
        </div>
        {model ? (
          <>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{model.name}</p>
            <Input size="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜模型" className="mb-1" />
            <ul className="max-h-56 overflow-auto">
              {list.map((c) => (
                <li key={c.value}>
                  <button type="button" onClick={() => choose(model, c.value)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted [&_svg]:size-4">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{c.name}</span>
                      {c.description && <span className="block truncate text-xs text-muted-foreground">{c.description}</span>}
                    </span>
                    {c.value === model.current && <Check className="text-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">这个 Agent 没有公布可选模型</p>
        )}
        {thought && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{thought.name}</p>
            <ToggleGroup type="single" size="sm" variant="outline" value={thought.current} onValueChange={(v) => v && choose(thought, v)}>
              {thought.choices.map((c) => (
                <ToggleGroupItem key={c.value} value={c.value}>
                  {c.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
