import { Button } from "@hx/ui/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@hx/ui/ui/dropdown-menu";
import { Textarea } from "@hx/ui/ui/textarea";
import { ArrowUp, Archive, ImagePlus, ShieldCheck, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { modePicker, nameOf, pick } from "../../../agentgui/options";
import { agDrafts, agPrefs, key } from "../../../agentgui/prefs";
import type { View } from "../../../agentgui/reduce";
import type { ContentBlock, SessionInfo, SlashCommand } from "../../../agentgui/types";
import { IMAGE_MAX_BYTES } from "../../../agentgui/constants";
import { useGui } from "./ctx";
import { KeyOf } from "./Keys";
import { Mentions, mentionQuery, toLinks } from "./Mentions";
import { ModelPanel } from "./ModelPanel";

type Props = {
  view: View;
  info?: SessionInfo;
  running: boolean;
  rejecting: boolean;
  disabled?: string;
  modelOpen: boolean;
  setModelOpen: (v: boolean) => void;
  onSend: (blocks: ContentBlock[]) => void;
  onStop: () => void;
  onRejectSay: (text: string) => void;
  draftRef?: React.MutableRefObject<((t: string) => void) | null>;
};
type Img = { name: string; mimeType: string; data: string; url: string };

const caps = (info?: SessionInfo) => ((info?.caps as { agent?: { promptCapabilities?: { image?: boolean } } } | undefined)?.agent?.promptCapabilities ?? {}) as { image?: boolean };

function readImage(f: File): Promise<Img> {
  return new Promise((ok, bad) => {
    if (f.size > IMAGE_MAX_BYTES) return bad(new Error(`${f.name} 超过 ${IMAGE_MAX_BYTES >> 20} MB`));
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      ok({ name: f.name || "图片", mimeType: f.type, data: url.slice(url.indexOf(",") + 1), url });
    };
    r.onerror = () => bad(new Error("读不出这张图"));
    r.readAsDataURL(f);
  });
}

// 输入框: 权限模式常驻, 模型面板, / 斜杠命令, @ 文件, 粘贴图片, 草稿按会话自动保存, mod+s 暂存; 运行中变停止
export function Composer({ view, info, running, rejecting, disabled, modelOpen, setModelOpen, onSend, onStop, onRejectSay, draftRef }: Props) {
  const { conn, sid, host, cmd } = useGui();
  const k = key(host, sid);
  const [text, setText] = useState(() => agDrafts.get(k));
  const [imgs, setImgs] = useState<Img[]>([]);
  const [sel, setSel] = useState(0);
  const [caret, setCaret] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const mode = modePicker(view, info);
  const canImg = Boolean(caps(info).image);
  const slash = /^\/\S*$/.test(text) ? view.commands.filter((c) => c.name.startsWith(text.slice(1))) : [];
  const mention = slash.length ? null : mentionQuery(text, caret);

  const edit = (v: string) => {
    setText(v);
    agDrafts.set(k, v);
  };

  useEffect(() => {
    if (!draftRef) return;
    draftRef.current = (t) => {
      setText((v) => {
        const n = v ? `${v} ${t}` : t;
        agDrafts.set(k, n);
        return n;
      });
      ta.current?.focus();
    };
    return () => {
      draftRef.current = null;
    };
  }, [draftRef, k]);

  const setMode = (v: string) => mode && void pick(conn, sid, mode, v).catch((e: Error) => toast.error(e.message));

  // 快捷键发来的命令: 停止, 轮换权限模式, 暂存 / 取回 (t3code 的 composer.stash)
  useEffect(
    () =>
      cmd.on((c) => {
        if (c === "turn.stop" && running) onStop();
        else if (c === "composer.mode" && mode && mode.choices.length > 1) {
          const i = mode.choices.findIndex((x) => x.value === mode.current);
          setMode((mode.choices[(i + 1) % mode.choices.length] as { value: string }).value);
        } else if (c === "composer.stash") {
          if (text.trim()) {
            agPrefs.push(k, text);
            edit("");
            toast.success("已暂存, 再按一次取回");
          } else {
            const v = agPrefs.pop(k);
            if (v === undefined) toast.info("没有暂存的草稿");
            else edit(v);
          }
          ta.current?.focus();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cmd, running, mode, text, k],
  );

  const addFiles = (files: File[]) => {
    const list = files.filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    if (!canImg) return void toast.error("这个 Agent 没声明支持图片");
    void Promise.all(list.map(readImage))
      .then((xs) => setImgs((v) => [...v, ...xs]))
      .catch((e: Error) => toast.error(e.message));
  };

  const submit = () => {
    const t = text.trim();
    if ((!t && imgs.length === 0) || disabled) return;
    if (rejecting) {
      if (!t) return;
      onRejectSay(t);
    } else {
      const blocks: ContentBlock[] = [{ type: "text", text: t }, ...imgs.map((i) => ({ type: "image", mimeType: i.mimeType, data: i.data, name: i.name })), ...toLinks(t, info?.cwd)];
      onSend(blocks);
      setImgs([]);
    }
    edit("");
  };

  const fill = (c: SlashCommand) => {
    edit(`/${c.name} `);
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
    // @ 补全列表已在原生监听里处理了这个键
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const syncCaret = () => setCaret(ta.current?.selectionStart ?? text.length);
  const stashed = agPrefs.stash(k).length;

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
      {mention && (
        <Mentions
          query={mention}
          textarea={ta}
          onPick={(path, dir) => {
            const before = text.slice(0, mention.start);
            const after = text.slice(caret);
            const ins = `@${path}${dir ? "/" : " "}`;
            edit(before + ins + after);
            const at = before.length + ins.length;
            requestAnimationFrame(() => {
              ta.current?.setSelectionRange(at, at);
              setCaret(at);
            });
          }}
        />
      )}
      <div
        className={`rounded-2xl border bg-card p-2 shadow-sm transition-colors ${rejecting ? "border-warning" : "border-border focus-within:border-ring"}`}
        onDragOver={(e) => canImg && e.preventDefault()}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          addFiles([...e.dataTransfer.files]);
        }}
      >
        {imgs.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-1 pb-2" aria-label="附件">
            {imgs.map((m, i) => (
              <li key={`${m.name}-${i}`} className="group relative size-14 overflow-hidden rounded-lg border border-border">
                <img src={m.url} alt={m.name} className="size-full object-cover" />
                <button type="button" aria-label={`移除 ${m.name}`} onClick={() => setImgs((v) => v.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          ref={ta}
          value={text}
          onChange={(e) => {
            edit(e.target.value);
            setSel(0);
            setCaret(e.target.selectionStart);
          }}
          onKeyDown={onKey}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          rows={2}
          disabled={Boolean(disabled)}
          placeholder={disabled ?? (rejecting ? "说明为什么不行, 回车 = 拒绝并把这句话带给 Agent" : running ? "运行中, 回车会排在这一轮之后" : "说点什么, / 看命令, @ 引用文件")}
          className="max-h-60 min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          aria-label="消息"
        />
        <div className="flex items-center gap-1 pt-1">
          {mode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" title="权限模式">
                  <ShieldCheck />
                  {nameOf(mode)}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel className="flex items-center justify-between gap-4">
                  {mode.name}
                  <KeyOf command="composer.mode" />
                </DropdownMenuLabel>
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
            <Button size="sm" variant="ghost" onClick={() => (edit("/"), ta.current?.focus())}>
              / 命令
            </Button>
          )}
          {canImg && (
            <>
              <Button size="icon-sm" variant="ghost" aria-label="附加图片" onClick={() => fileIn.current?.click()}>
                <ImagePlus />
              </Button>
              <input ref={fileIn} type="file" accept="image/*" multiple hidden onChange={(e) => (addFiles([...(e.target.files ?? [])]), (e.target.value = ""))} />
            </>
          )}
          <span className="flex-1" />
          {stashed > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title="mod+s 取回">
              <Archive className="size-3" />
              暂存 {stashed}
            </span>
          )}
          {running && (
            <Button size="sm" variant="outline" onClick={onStop}>
              <Square />
              停止
              <KeyOf command="turn.stop" className="opacity-60" />
            </Button>
          )}
          {(!running || text.trim()) && (
            <Button size="icon-sm" onClick={submit} disabled={(!text.trim() && imgs.length === 0) || Boolean(disabled)} aria-label={rejecting ? "拒绝并说明" : "发送"}>
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
