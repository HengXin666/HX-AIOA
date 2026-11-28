import { Button } from "@hx/ui/ui/button";
import { Spin } from "@hx/ui/ui/spin";
import { ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { KIND_LABEL } from "../../../agentgui/constants";
import { diffStat, lineDiff, type Tool, type ToolRow as Row } from "../../../agentgui/reduce";
import { useGui } from "./ctx";
import { AddDel, DiffView } from "./Diff";
import { basename, duration, KindIcon } from "./parts";

const RUNNING = new Set(["pending", "in_progress"]);
const pathOf = (t: Tool): string => t.locations[0]?.path ?? "";

function label(t: Tool): string {
  if (t.title) return t.title;
  const p = pathOf(t);
  return `${KIND_LABEL[t.kind] ?? KIND_LABEL.other} ${p ? basename(p) : ""}`.trim();
}

// 一行工具调用 (同文件连续读写已合并); 点开看参数, diff, 输出
export function ToolRowView({ row, open: initOpen = false }: { row: Row; open?: boolean }) {
  const [open, setOpen] = useState(initOpen);
  const head = row.tools[0] as Tool;
  const tail = row.tools[row.tools.length - 1] as Tool;
  const stat = row.tools.reduce((a, t) => {
    const d = diffStat(t);
    return { add: a.add + d.add, del: a.del + d.del };
  }, { add: 0, del: 0 });
  const running = row.tools.some((t) => RUNNING.has(t.status));
  const failed = row.tools.some((t) => t.status === "failed");
  const ms = head.start && tail.end ? tail.end - head.start : 0;
  return (
    <div className="text-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted [&_svg]:size-4 [&_svg]:shrink-0">
        <span className={failed ? "text-destructive" : "text-muted-foreground"}>
          <KindIcon kind={row.kind} />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">{label(head)}</span>
        {row.tools.length > 1 && <span className="shrink-0 text-xs text-muted-foreground">x{row.tools.length}</span>}
        <AddDel {...stat} />
        {running && <Spin size="sm" />}
        {failed && <CircleAlert className="text-destructive" aria-label="失败" />}
        {ms > 1000 && !running && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{duration(ms)}</span>}
        <ChevronRight className={`text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-1 mb-2 ml-8 flex flex-col gap-2">
          {row.tools.map((t) => (
            <ToolDetail key={t.id} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolDetail({ tool }: { tool: Tool }) {
  const { openRight } = useGui();
  const texts = tool.content.flatMap((c) => (c.type === "content" && c.content.type === "text" && c.content.text ? [c.content.text] : []));
  const diffs = tool.content.flatMap((c) => (c.type === "diff" ? [c] : []));
  const terminal = tool.content.some((c) => c.type === "terminal");
  const execute = tool.kind === "execute" || terminal;
  return (
    <div className="flex flex-col gap-2">
      {tool.rawInput !== undefined && <Raw title="参数" value={tool.rawInput} />}
      {diffs.map((d, i) => (
        <div key={i} className="flex flex-col gap-1">
          <span className="font-mono text-xs text-muted-foreground">{d.path}</span>
          <DiffView lines={lineDiff(d.oldText ?? "", d.newText)} onOpen={() => openRight("changes", d.path)} />
        </div>
      ))}
      {texts.length > 0 && <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">{texts.join("\n")}</pre>}
      <Output tool={tool} auto={execute && texts.length === 0} />
      {tool.rawOutput !== undefined && <Raw title="原始输出" value={tool.rawOutput} />}
    </div>
  );
}

function Raw({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const short = text.length < 160 && !text.includes("\n");
  if (short) return <p className="font-mono text-xs break-all text-muted-foreground">{title}: {text}</p>;
  return (
    <div>
      <Button size="xs" variant="ghost" onClick={() => setOpen(!open)}>
        {open ? `收起${title}` : `看${title}`}
      </Button>
      {open && <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">{text}</pre>}
    </div>
  );
}

// 探针回的是 ACP 工具内容原样: 文本块拼起来, 其它结构照 JSON 显示
function outputText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    const parts = c.map((x) => {
      const b = (x ?? {}) as { type?: string; text?: string; output?: string; content?: { text?: string } };
      return b.content?.text ?? b.text ?? b.output ?? JSON.stringify(x, null, 2);
    });
    return parts.join("\n");
  }
  return JSON.stringify(c, null, 2);
}

// 命令输出不进事件流: 展开这一行才向探针要 (终端样式, 有界滚动)
function Output({ tool, auto }: { tool: Tool; auto: boolean }) {
  const { conn, sid } = useGui();
  const [state, setState] = useState<{ text?: string; err?: string; loading?: boolean }>({});
  const load = () => {
    setState({ loading: true });
    conn
      .hx<{ content: unknown }>("tool/output", { sid, toolCallId: tool.id })
      .then((r) => setState({ text: outputText(r?.content) }))
      .catch((e: Error) => setState({ err: e.message }));
  };
  useEffect(() => {
    if (auto) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, tool.id]);
  if (state.loading) return <Spin size="sm" />;
  if (state.err) return <p className="text-xs text-destructive">取输出失败: {state.err}</p>;
  if (state.text !== undefined)
    return <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">{state.text || "(没有输出)"}</pre>;
  return (
    <div>
      <Button size="xs" variant="ghost" onClick={load}>
        完整输出
      </Button>
    </div>
  );
}
