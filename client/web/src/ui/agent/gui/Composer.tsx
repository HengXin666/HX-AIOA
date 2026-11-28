import type { AgFsEntry } from "@hx-aioa/protocol";
import { ComposerSelect, ContextMeter, PromptInput, type PromptSuggestion } from "@hx/ui/agent";
import { File, Folder, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IMAGE_MAX_BYTES, MENTION_MAX } from "../../../agentgui/constants";
import { modePicker, pick } from "../../../agentgui/options";
import { agDrafts, agPrefs, key } from "../../../agentgui/prefs";
import type { View } from "../../../agentgui/reduce";
import type { ContentBlock, SessionInfo, Stats } from "../../../agentgui/types";
import { useGui } from "./ctx";
import { toLinks } from "./Mentions";
import { ModelPanel } from "./ModelPanel";

type Props = {
  view: View;
  info?: SessionInfo;
  stats: Stats | null;
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

const caps = (info?: SessionInfo) => ((info?.caps as { agent?: { promptCapabilities?: { image?: boolean } } } | undefined)?.agent?.promptCapabilities ?? {}) as { image?: boolean };

function imageBlock(f: File): Promise<ContentBlock> {
  return new Promise((ok, bad) => {
    if (f.size > IMAGE_MAX_BYTES) return bad(new Error(`${f.name} 超过 ${IMAGE_MAX_BYTES >> 20} MB`));
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      ok({ type: "image", mimeType: f.type, data: url.slice(url.indexOf(",") + 1), name: f.name || "图片" });
    };
    r.onerror = () => bad(new Error("读不出这张图"));
    r.readAsDataURL(f);
  });
}

// 输入框: HX-UI PromptInput (/ 命令, @ 文件, 附件, 运行中变停止); 草稿按会话自动保存, mod+s 暂存, 权限模式与模型在左下
export function Composer({ view, info, stats, running, rejecting, disabled, modelOpen, setModelOpen, onSend, onStop, onRejectSay, draftRef }: Props) {
  const { conn, sid, host, cmd } = useGui();
  const k = key(host, sid);
  const [text, setText] = useState(() => agDrafts.get(k));
  const box = useRef<HTMLDivElement>(null);
  const mode = modePicker(view, info);
  const canImg = Boolean(caps(info).image);
  const focus = () => requestAnimationFrame(() => box.current?.querySelector("textarea")?.focus());

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
      focus();
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
          focus();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cmd, running, mode, text, k],
  );

  // @ 文件: 一层一层走探针的 fs/tree, 只在会话工作目录内
  const mentions = async (q: string): Promise<PromptSuggestion[]> => {
    const cut = q.lastIndexOf("/");
    const dir = cut < 0 ? "" : q.slice(0, cut);
    const name = (cut < 0 ? q : q.slice(cut + 1)).toLowerCase();
    const r = await conn.hx<{ entries: AgFsEntry[] }>("fs/tree", { sid, path: dir || undefined }).catch(() => ({ entries: [] as AgFsEntry[] }));
    return r.entries
      .filter((e) => !name || e.name.toLowerCase().includes(name))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(name)) - Number(a.name.toLowerCase().startsWith(name)) || Number(b.dir) - Number(a.dir))
      .slice(0, MENTION_MAX)
      .map((e) => {
        const path = dir ? `${dir}/${e.name}` : e.name;
        return { value: e.dir ? `${path}/` : path, label: e.dir ? `${e.name}/` : e.name, description: dir || undefined, icon: e.dir ? <Folder /> : <File /> };
      });
  };

  const submit = (raw: string, files: File[]) => {
    const t = raw.trim();
    if (disabled) return;
    if (rejecting) {
      if (t) onRejectSay(t);
      edit("");
      return;
    }
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!t && imgs.length === 0) return;
    void Promise.all(imgs.map(imageBlock))
      .then((blocks) => {
        onSend([...(t ? [{ type: "text", text: t } as ContentBlock] : []), ...blocks, ...toLinks(t, info?.cwd)]);
        edit("");
      })
      .catch((e: Error) => toast.error(e.message));
  };

  const ctx = stats?.ctx;
  const stashed = agPrefs.stash(k).length;

  return (
    <div ref={box} className="mx-auto w-full max-w-[768px]">
      <PromptInput
        value={text}
        onValueChange={edit}
        onSubmit={submit}
        busy={running && !text.trim()}
        onStop={onStop}
        disabled={Boolean(disabled)}
        attachments={canImg}
        accept="image/*"
        commands={view.commands.map((c) => ({ value: `/${c.name}`, label: `/${c.name}`, description: c.description }))}
        mentions={mentions}
        placeholder={disabled ?? (rejecting ? "说明为什么不行, 回车 = 拒绝并把这句话带给 Agent" : running ? "运行中, 回车会排在这一轮之后" : "说点什么, / 看命令, @ 引用文件")}
        busyPlaceholder="运行中, 回车会排在这一轮之后"
        className={rejecting ? "ring-1 ring-warning" : undefined}
        toolbar={
          <>
            {mode && <ComposerSelect label={mode.name || "权限模式"} options={mode.choices.map((c) => ({ value: c.value, label: c.name, description: c.description, icon: <ShieldCheck /> }))} value={mode.current} onValueChange={setMode} />}
            <ModelPanel view={view} info={info} open={modelOpen} setOpen={setModelOpen} />
          </>
        }
        status={
          <>
            {stashed > 0 && <span className="text-xs text-muted-foreground" title="mod+s 取回">暂存 {stashed}</span>}
            {ctx && ctx[1] > 0 && <ContextMeter used={ctx[0]} max={ctx[1]} />}
          </>
        }
      />
    </div>
  );
}
