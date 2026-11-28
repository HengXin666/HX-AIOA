import { Button } from "@hx/ui/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@hx/ui/ui/dropdown-menu";
import { Textarea } from "@hx/ui/ui/textarea";
import { ArrowUp, ShieldCheck, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { modePicker, nameOf, pick } from "../../../agentgui/options";
import type { View } from "../../../agentgui/reduce";
import type { SessionInfo, SlashCommand } from "../../../agentgui/types";
import { useGui } from "./ctx";
import { ModelPanel } from "./ModelPanel";

type Props = {
  view: View;
  info?: SessionInfo;
  running: boolean;
  rejecting: boolean;
  disabled?: string;
  modelOpen: boolean;
  setModelOpen: (v: boolean) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onRejectSay: (text: string) => void;
  draftRef?: React.MutableRefObject<((t: string) => void) | null>;
};

// 输入框: 权限模式常驻, 模型面板, / 斜杠命令 (来自 available_commands_update), 运行中变停止
export function Composer({ view, info, running, rejecting, disabled, modelOpen, setModelOpen, onSend, onStop, onRejectSay, draftRef }: Props) {
  const { conn, sid } = useGui();
  const [text, setText] = useState("");
  const [sel, setSel] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const mode = modePicker(view, info);
  const slash = /^\/\S*$/.test(text) ? view.commands.filter((c) => c.name.startsWith(text.slice(1))) : [];

  useEffect(() => {
    if (!draftRef) return;
    draftRef.current = (t) => {
      setText((v) => (v ? `${v} ${t}` : t));
      ta.current?.focus();
    };
    return () => {
      draftRef.current = null;
    };
  }, [draftRef]);

  const setMode = (v: string) => mode && void pick(conn, sid, mode, v).catch((e: Error) => toast.error(e.message));

  // Ctrl+. 停止; Ctrl+Shift+A 轮换权限模式
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "." && running) {
        e.preventDefault();
        onStop();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a" && mode && mode.choices.length > 1) {
        e.preventDefault();
        const i = mode.choices.findIndex((c) => c.value === mode.current);
        setMode((mode.choices[(i + 1) % mode.choices.length] as { value: string }).value);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    if (rejecting) onRejectSay(t);
    else onSend(t);
    setText("");
  };

  const fill = (c: SlashCommand) => {
    setText(`/${c.name} `);
    ta.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (slash.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (s + (e.key === "ArrowDown" ? 1 : slash.length - 1)) % slash.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        return fill(slash[Math.min(sel, slash.length - 1)] as SlashCommand);
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative mx-auto w-full max-w-[768px]">
      {slash.length > 0 && (
        <ul role="listbox" aria-label="斜杠命令" className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-md">
          {slash.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === sel}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fill(c)} className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === sel ? "bg-accent" : "hover:bg-muted"}`}>
                <span className="font-mono text-foreground">/{c.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.description}</span>
                {c.input?.hint && <span className="text-xs text-muted-foreground">{c.input.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={`rounded-2xl border bg-card p-2 shadow-sm ${rejecting ? "border-warning" : "border-border"}`}>
        <Textarea
          ref={ta}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
          rows={2}
          disabled={Boolean(disabled)}
          placeholder={disabled ?? (rejecting ? "说明为什么不行, 回车 = 拒绝并把这句话带给 Agent" : running ? "运行中, 回车会排在这一轮之后" : "说点什么, / 看命令")}
          className="max-h-60 min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          aria-label="消息"
        />
        <div className="flex items-center gap-1 pt-1">
          {mode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" title="权限模式 (Ctrl+Shift+A)">
                  <ShieldCheck />
                  {nameOf(mode)}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>{mode.name}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={mode.current} onValueChange={setMode}>
                  {mode.choices.map((c) => (
                    <DropdownMenuRadioItem key={c.value} value={c.value}>
                      <span className="flex flex-col">
                        {c.name}
                        {c.description && <span className="text-xs text-muted-foreground">{c.description}</span>}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <ModelPanel view={view} info={info} open={modelOpen} setOpen={setModelOpen} />
          {view.commands.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => (setText("/"), ta.current?.focus())}>
              / 命令
            </Button>
          )}
          <span className="flex-1" />
          {running && (
            <Button size="sm" variant="outline" onClick={onStop} title="停止 (Ctrl+.)">
              <Square />
              停止
            </Button>
          )}
          {(!running || text.trim()) && (
            <Button size="icon-sm" onClick={submit} disabled={!text.trim() || Boolean(disabled)} aria-label={rejecting ? "拒绝并说明" : "发送"}>
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
