import type { AgFsEntry } from "@hx-aioa/protocol";
import { File, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { MENTION_MAX } from "../../../agentgui/constants";
import type { ContentBlock } from "../../../agentgui/types";
import { useGui } from "./ctx";

export type MentionQuery = { start: number; dir: string; name: string };
const MENTION_RE = /(^|\s)@([^\s@]*)$/;
const TOKEN_RE = /(?:^|\s)@([^\s@]+[^\s@/])(?=\s|$)/g;

// 光标前是 @xxx 时返回要补全的目录与名字前缀
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const m = MENTION_RE.exec(text.slice(0, caret));
  if (!m) return null;
  const q = m[2] ?? "";
  const cut = q.lastIndexOf("/");
  return { start: caret - q.length - 1, dir: cut < 0 ? "" : q.slice(0, cut), name: cut < 0 ? q : q.slice(cut + 1) };
}

// 发送时把 @路径 变成 ACP resource_link (所有 Agent 都必须支持), 文字里的 @路径 原样保留
export function toLinks(text: string, cwd?: string): ContentBlock[] {
  if (!cwd) return [];
  const seen = new Set<string>();
  const out: ContentBlock[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const p = m[1] as string;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ type: "resource_link", uri: `file://${cwd.replace(/\/$/, "")}/${p}`, name: p.split("/").pop() ?? p });
  }
  return out;
}

// @ 文件补全: 一层一层走探针的 fs/tree (与 t3code 的 @ 提及同样只在会话工作目录内)
export function Mentions({ query, textarea, onPick }: { query: MentionQuery; textarea: React.RefObject<HTMLTextAreaElement | null>; onPick: (path: string, dir: boolean) => void }) {
  const { conn, sid } = useGui();
  const [entries, setEntries] = useState<AgFsEntry[] | null>(null);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    let live = true;
    setEntries(null);
    conn
      .hx<{ entries: AgFsEntry[] }>("fs/tree", { sid, path: query.dir || undefined })
      .then((r) => live && setEntries(r.entries))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [conn, sid, query.dir]);
  const n = query.name.toLowerCase();
  const list = (entries ?? [])
    .filter((e) => !n || e.name.toLowerCase().includes(n))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(n)) - Number(a.name.toLowerCase().startsWith(n)) || Number(b.dir) - Number(a.dir))
    .slice(0, MENTION_MAX);
  const choose = (e: AgFsEntry) => onPick(query.dir ? `${query.dir}/${e.name}` : e.name, e.dir);

  useEffect(() => setSel(0), [query.dir, query.name]);
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    const on = (e: KeyboardEvent) => {
      if (e.isComposing || list.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (s + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
      } else if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        choose(list[Math.min(sel, list.length - 1)] as AgFsEntry);
      }
    };
    el.addEventListener("keydown", on);
    return () => el.removeEventListener("keydown", on);
  });

  if (entries && list.length === 0) return null;
  return (
    <ul role="listbox" aria-label="引用文件" className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-md">
      {!entries && <li className="px-2 py-1.5 text-xs text-muted-foreground">读取 {query.dir || "工作目录"}</li>}
      {list.map((e, i) => (
        <li key={e.name} role="option" aria-selected={i === sel}>
          <button type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => choose(e)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm [&_svg]:size-4 [&_svg]:shrink-0 ${i === sel ? "bg-accent" : "hover:bg-muted"}`}>
            {e.dir ? <Folder className="text-info" /> : <File className="text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate font-mono text-foreground">
              {query.dir ? <span className="text-muted-foreground">{query.dir}/</span> : null}
              {e.name}
              {e.dir ? "/" : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
