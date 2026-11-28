import { Button } from "@hx/ui/ui/button";
import { Spin } from "@hx/ui/ui/spin";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@hx/ui/ui/tabs";
import { DiffView as HxDiff, parseUnifiedDiff } from "@hx/ui/agent";
import { ArrowLeft, ChevronRight, File, Folder, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useConn } from "../../../agentgui/hooks";
import type { View } from "../../../agentgui/reduce";
import type { AgFsEntry, AgGitFile } from "@hx-aioa/protocol";
import type { RightTab } from "./ctx";
import { useGui } from "./ctx";
import { AddDel } from "./Diff";
import { basename } from "./parts";
import { PlanList } from "./Timeline";

type Load<T> = { data?: T; err?: string; loading: boolean };

function useHx<T>(m: string, p: object, deps: unknown[]): Load<T> & { reload: () => void } {
  const { conn, host } = useGui();
  const ready = useConn(host).state === "ready";
  const [s, setS] = useState<Load<T>>({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setS((x) => ({ ...x, loading: true }));
    conn
      .hx<T>(m, p)
      .then((data) => live && setS({ data, loading: false }))
      .catch((e: Error) => live && setS({ err: e.message, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n, ready]);
  return { ...s, reload: useCallback(() => setN((x) => x + 1), []) };
}

function State({ s }: { s: Load<unknown> }) {
  if (s.loading && !s.data) return <Spin className="m-4" />;
  if (s.err) return <p className="p-3 text-sm text-destructive">{s.err}</p>;
  return null;
}

const DIFF_FOLD = 400;
// git 状态字母上色: 新增绿, 删除红, 其余黄
function statusTone(x: string, y: string): string {
  const v = `${x}${y}`;
  if (v.includes("?") || v.includes("A")) return "text-success";
  if (v.includes("D")) return "text-destructive";
  return "text-warning";
}

// 右栏: 改动 (git status / diff) | 文件 (树 + 预览) | 计划
export function RightPane({ tab, setTab, path, view, onClose }: { tab: RightTab; setTab: (t: RightTab) => void; path?: string; view: View; onClose: () => void }) {
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as RightTab)} className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <TabsList variant="line">
          <TabsTrigger value="changes">改动</TabsTrigger>
          <TabsTrigger value="files">文件</TabsTrigger>
          <TabsTrigger value="plan">计划</TabsTrigger>
        </TabsList>
        <span className="flex-1" />
        <Button size="icon-sm" variant="ghost" aria-label="收起右栏" onClick={onClose}>
          <X />
        </Button>
      </div>
      <TabsContent value="changes" className="min-h-0 flex-1 overflow-auto">
        <Changes focus={path} view={view} />
      </TabsContent>
      <TabsContent value="files" className="min-h-0 flex-1 overflow-auto">
        <Files />
      </TabsContent>
      <TabsContent value="plan" className="min-h-0 flex-1 overflow-auto p-3">
        <Plans view={view} />
      </TabsContent>
    </Tabs>
  );
}

const EDITS = new Set(["edit", "delete", "move"]);
function editedIn(turns: View["turns"]): string[] {
  const set = new Set<string>();
  for (const t of turns) for (const i of t.items) if (i.t === "tool" && EDITS.has(i.tool.kind)) for (const l of i.tool.locations) set.add(l.path);
  return [...set];
}

function Group({ title, paths, open, setOpen }: { title: string; paths: string[]; open?: string; setOpen: (p?: string) => void }) {
  if (paths.length === 0) return null;
  return (
    <div className="border-b border-border pb-1">
      <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        {title} · {paths.length}
      </p>
      {paths.map((p) => (
        <div key={p}>
          <button type="button" onClick={() => setOpen(open === p ? undefined : p)} className="w-full truncate px-3 py-1 text-left font-mono text-xs text-foreground hover:bg-muted" title={p}>
            {p}
          </button>
          {open === p && <FileDiff path={p} />}
        </div>
      ))}
    </div>
  );
}

function Changes({ focus, view }: { focus?: string; view: View }) {
  const turn = editedIn(view.turns.slice(-1));
  const session = editedIn(view.turns);
  const { sid } = useGui();
  const st = useHx<{ branch: string; files: AgGitFile[] }>("git/status", { sid }, [sid]);
  const [open, setOpen] = useState<string | undefined>(focus);
  useEffect(() => setOpen(focus), [focus]);
  const files = st.data?.files ?? [];
  const add = files.reduce((n, f) => n + (f.add || 0), 0);
  const del = files.reduce((n, f) => n + (f.del || 0), 0);
  const [openG, setOpenG] = useState<string | undefined>();
  return (
    <div className="flex flex-col">
      <Group title="本轮改动" paths={turn} open={openG} setOpen={setOpenG} />
      <Group title="会话里改过的" paths={session.filter((p) => !turn.includes(p))} open={openG} setOpen={setOpenG} />
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          全部未提交 · {files.length} 个文件 {st.data?.branch ? `· ${st.data.branch}` : ""}
        </span>
        <AddDel add={add} del={del} />
        <Button size="icon-xs" variant="ghost" aria-label="刷新" onClick={st.reload}>
          <RefreshCw />
        </Button>
      </div>
      <State s={st} />
      {st.data && files.length === 0 && <p className="px-3 text-sm text-muted-foreground">没有未提交的改动</p>}
      <ul>
        {files.map((f) => (
          <li key={f.path} className="border-t border-border">
            <button type="button" onClick={() => setOpen(open === f.path ? undefined : f.path)} aria-expanded={open === f.path} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent/60">
              <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open === f.path ? "rotate-90" : ""}`} />
              <span className={`w-4 shrink-0 text-center font-mono text-[11px] font-semibold ${statusTone(f.x, f.y)}`}>{`${f.x}${f.y}`.trim().slice(0, 1) || "M"}</span>
              <span className="min-w-0 flex-1 truncate text-xs" title={f.path}>
                <span className="text-foreground">{basename(f.path)}</span>
                {f.path.includes("/") && <span className="ml-1.5 text-muted-foreground">{f.path.slice(0, f.path.lastIndexOf("/"))}</span>}
              </span>
              <AddDel add={f.add} del={f.del} />
            </button>
            {open === f.path && <FileDiff path={f.path} />}
          </li>
        ))}
      </ul>
      {focus && !files.some((f) => f.path === focus) && st.data && (
        <div className="border-t border-border">
          <p className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{focus}</p>
          <FileDiff path={focus} />
        </div>
      )}
    </div>
  );
}

function FileDiff({ path }: { path: string }) {
  const { sid } = useGui();
  const d = useHx<{ diff: string }>("git/diff", { sid, path }, [sid, path]);
  const parsed = d.data ? parseUnifiedDiff(d.data.diff) : [];
  return (
    <div className="px-2 pb-2">
      <State s={d} />
      {d.data && parsed.length === 0 && <p className="text-xs text-muted-foreground">没有差异 (可能是新文件未跟踪)</p>}
      {parsed.map((f, i) => (
        <HxDiff key={f.path ?? i} rows={f.rows} fold={DIFF_FOLD} />
      ))}
    </div>
  );
}

function Files() {
  const { sid, insert } = useGui();
  const [dir, setDir] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const tree = useHx<{ entries: AgFsEntry[] }>("fs/tree", dir ? { sid, path: dir } : { sid }, [sid, dir]);
  if (file) return <Preview path={file} onBack={() => setFile(null)} onLine={(n) => insert(`@${file}:${n}`)} />;
  const join = (name: string) => (dir ? `${dir}/${name}` : name);
  const entries = (tree.data?.entries ?? []).slice().sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1.5">
        {dir && (
          <Button size="icon-xs" variant="ghost" aria-label="上一级" onClick={() => setDir(dir.split("/").slice(0, -1).join("/"))}>
            <ArrowLeft />
          </Button>
        )}
        <span className="truncate font-mono text-xs text-muted-foreground">{dir || "."}</span>
      </div>
      <State s={tree} />
      <ul>
        {entries.map((e) => (
          <li key={e.name}>
            <button type="button" onClick={() => (e.dir ? setDir(join(e.name)) : setFile(join(e.name)))} className="flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-muted [&_svg]:size-4 [&_svg]:shrink-0">
              {e.dir ? <Folder className="text-info" /> : <File className="text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{e.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Preview({ path, onBack, onLine }: { path: string; onBack: () => void; onLine: (n: number) => void }) {
  const { sid } = useGui();
  const r = useHx<{ text: string; truncated: boolean }>("fs/read", { sid, path }, [sid, path]);
  const lines = r.data?.text.split("\n") ?? [];
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Button size="icon-xs" variant="ghost" aria-label="返回文件树" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <span className="truncate font-mono text-xs text-foreground">{path}</span>
      </div>
      <State s={r} />
      <pre className="overflow-auto font-mono text-xs leading-5">
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <button type="button" title="插入 @文件:行 到输入框" onClick={() => onLine(i + 1)} className="w-10 shrink-0 pr-2 text-right text-muted-foreground select-none hover:text-foreground">
              {i + 1}
            </button>
            <span className="whitespace-pre text-foreground">{l}</span>
          </div>
        ))}
      </pre>
      {r.data?.truncated && <p className="p-2 text-xs text-muted-foreground">文件太大, 只显示了前 256 KB</p>}
    </div>
  );
}

function Plans({ view }: { view: View }) {
  const history = view.turns.flatMap((t) => t.items.flatMap((i) => (i.t === "plan" ? [{ key: i.key, entries: i.entries }] : []))).reverse();
  if (!view.plan && history.length === 0) return <p className="text-sm text-muted-foreground">这个会话还没有计划</p>;
  return (
    <div className="flex flex-col gap-3">
      {view.plan && <PlanList entries={view.plan} />}
      {history.length > 1 && <p className="text-xs font-medium text-muted-foreground">历史计划</p>}
      {history.slice(1).map((p) => (
        <PlanList key={p.key} entries={p.entries} />
      ))}
    </div>
  );
}
