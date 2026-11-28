import type { ConfigOption, ContentBlock, JsonRpc, LogItem, ModeState, ModelState, PlanEntry, SlashCommand, ToolContent, ToolLocation, Usage } from "./types";

// 原始 ACP 消息 -> 时间线模型。纯函数式数据, 每次 push 只替换改到的轮与项, React 按引用比较
export type Tool = {
  id: string;
  kind: string;
  title: string;
  status: string;
  content: ToolContent[];
  locations: ToolLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  start?: number;
  end?: number;
};
export type Item =
  | { t: "msg"; key: string; text: string }
  | { t: "thought"; key: string; text: string; start?: number; end?: number }
  | { t: "tool"; key: string; tool: Tool }
  | { t: "plan"; key: string; entries: PlanEntry[] }
  | { t: "error"; key: string; msg: string; code?: number | string; data?: unknown }
  | { t: "note"; key: string; text: string };
export type TurnUsage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
export type Turn = {
  key: string;
  seq: number;
  user: ContentBlock[] | null;
  items: Item[];
  running: boolean;
  stop?: string;
  start?: number;
  end?: number;
  usage?: TurnUsage;
  local?: boolean;
};
export type View = {
  turns: Turn[];
  plan: PlanEntry[] | null;
  commands: SlashCommand[];
  modes: ModeState | null;
  models: ModelState | null;
  config: ConfigOption[];
  usage: Usage | null;
  title?: string;
};

export const EMPTY_VIEW: View = { turns: [], plan: null, commands: [], modes: null, models: null, config: [], usage: null };
const PROMPT = "session/prompt";
const UPDATE = "session/update";
const PERMISSION = "session/request_permission";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const textOf = (c: unknown): string => {
  const b = obj(c);
  return b.type === "text" ? str(b.text) : "";
};

export class Reducer {
  view: View = EMPTY_VIEW;
  private where = new Map<string, [number, number]>();
  private prompts = new Set<string>();

  constructor(items: LogItem[] = []) {
    for (const it of items) this.push(it);
  }

  push(it: LogItem): void {
    const m = it.m;
    const at = it.at;
    if (m.method === PROMPT) return this.prompt(it);
    if (m.method === UPDATE) return this.update(obj(m.params?.update), at, it.seq);
    if (m.method === PERMISSION) {
      const tc = obj(m.params?.toolCall);
      if (tc.toolCallId) this.tool(tc, at, it.seq);
      return;
    }
    if (m.method === undefined && m.id !== undefined) this.response(m, at, it.seq);
  }

  private set(p: Partial<View>): void {
    this.view = { ...this.view, ...p };
  }

  private prompt(it: LogItem): void {
    const p = it.m.params ?? {};
    if (it.m.id !== undefined) this.prompts.add(String(it.m.id));
    const blocks = Array.isArray(p.prompt) ? (p.prompt as ContentBlock[]) : [];
    const turn: Turn = { key: `t${it.seq}`, seq: it.seq, user: blocks, items: [], running: true, start: it.at, local: it.seq % 1 !== 0 };
    const turns = this.view.turns.map((t) => (t.running ? { ...t, running: false } : t));
    this.set({ turns: [...turns, turn] });
  }

  private current(seq: number, at?: number): number {
    const n = this.view.turns.length;
    if (n > 0) return n - 1;
    this.set({ turns: [{ key: `t${seq}`, seq, user: null, items: [], running: true, start: at }] });
    return 0;
  }

  private patchTurn(i: number, fn: (t: Turn) => Turn): void {
    const turns = this.view.turns.slice();
    turns[i] = fn(turns[i] as Turn);
    this.set({ turns });
  }

  private addItem(item: Item, seq: number, at?: number): void {
    const i = this.current(seq, at);
    this.patchTurn(i, (t) => ({ ...t, items: [...t.items, item] }));
    if (item.t === "tool") this.where.set(item.tool.id, [i, (this.view.turns[i] as Turn).items.length - 1]);
  }

  // 连续的同类文字块合并成一项
  private chunk(kind: "msg" | "thought", text: string, seq: number, at?: number): void {
    if (!text) return;
    const i = this.current(seq, at);
    const turn = this.view.turns[i] as Turn;
    const last = turn.items[turn.items.length - 1];
    if (last && last.t === kind) {
      const merged = kind === "thought" ? { ...last, text: last.text + text, end: at ?? (last as { end?: number }).end } : { ...last, text: last.text + text };
      this.patchTurn(i, (t) => ({ ...t, items: [...t.items.slice(0, -1), merged as Item] }));
      return;
    }
    this.addItem(kind === "thought" ? { t: "thought", key: `h${seq}`, text, start: at, end: at } : { t: "msg", key: `m${seq}`, text }, seq, at);
  }

  private userChunk(content: unknown, seq: number, at?: number): void {
    const block = obj(content) as ContentBlock;
    const n = this.view.turns.length;
    const last = this.view.turns[n - 1];
    if (last && last.user && last.items.length === 0) {
      const blocks = last.user.slice();
      const tail = blocks[blocks.length - 1];
      if (tail?.type === "text" && block.type === "text") blocks[blocks.length - 1] = { ...tail, text: (tail.text ?? "") + (block.text ?? "") };
      else blocks.push(block);
      return this.patchTurn(n - 1, (t) => ({ ...t, user: blocks }));
    }
    const turns = this.view.turns.map((t) => (t.running ? { ...t, running: false } : t));
    this.set({ turns: [...turns, { key: `t${seq}`, seq, user: [block], items: [], running: true, start: at }] });
  }

  private tool(u: Record<string, unknown>, at: number | undefined, seq: number): void {
    const id = str(u.toolCallId);
    const pos = this.where.get(id);
    const prev = pos ? this.itemAt(pos) : undefined;
    const base: Tool = prev ?? { id, kind: "other", title: "", status: "pending", content: [], locations: [], start: at };
    const next: Tool = { ...base };
    if (typeof u.kind === "string") next.kind = u.kind;
    if (typeof u.title === "string") next.title = u.title;
    if (typeof u.status === "string") next.status = u.status;
    if (Array.isArray(u.content)) next.content = u.content as ToolContent[];
    if (Array.isArray(u.locations)) next.locations = u.locations as ToolLocation[];
    if ("rawInput" in u) next.rawInput = u.rawInput;
    if ("rawOutput" in u) next.rawOutput = u.rawOutput;
    if ((next.status === "completed" || next.status === "failed") && next.end === undefined) next.end = at;
    if (pos && prev) {
      const [ti, ii] = pos;
      return this.patchTurn(ti, (t) => {
        const items = t.items.slice();
        items[ii] = { t: "tool", key: (items[ii] as Item).key, tool: next };
        return { ...t, items };
      });
    }
    this.addItem({ t: "tool", key: `c${id}`, tool: next }, seq, at);
  }

  private itemAt([ti, ii]: [number, number]): Tool | undefined {
    const it = this.view.turns[ti]?.items[ii];
    return it?.t === "tool" ? it.tool : undefined;
  }

  private plan(entries: PlanEntry[], seq: number, at?: number): void {
    this.set({ plan: entries });
    const i = this.current(seq, at);
    const turn = this.view.turns[i] as Turn;
    const k = turn.items.findIndex((x) => x.t === "plan");
    if (k < 0) return this.addItem({ t: "plan", key: `p${seq}`, entries }, seq, at);
    this.patchTurn(i, (t) => {
      const items = t.items.slice();
      items[k] = { t: "plan", key: (items[k] as Item).key, entries };
      return { ...t, items };
    });
  }

  private update(u: Record<string, unknown>, at: number | undefined, seq: number): void {
    switch (u.sessionUpdate) {
      case "user_message_chunk":
        return this.userChunk(u.content, seq, at);
      case "agent_message_chunk":
        return this.chunk("msg", textOf(u.content), seq, at);
      case "agent_thought_chunk":
        return this.chunk("thought", textOf(u.content), seq, at);
      case "tool_call":
        return this.tool(u, at, seq);
      case "tool_call_update":
        return this.tool(u, at, seq);
      case "plan":
        return this.plan(Array.isArray(u.entries) ? (u.entries as PlanEntry[]) : [], seq, at);
      case "available_commands_update":
        return this.set({ commands: Array.isArray(u.availableCommands) ? (u.availableCommands as SlashCommand[]) : [] });
      case "current_mode_update": {
        const id = str(u.currentModeId) || str(u.modeId);
        const modes = this.view.modes ?? { currentModeId: id, availableModes: [] };
        return this.set({ modes: { ...modes, currentModeId: id } });
      }
      case "config_option_update":
      case "config_options_update":
        if (Array.isArray(u.configOptions)) this.set({ config: u.configOptions as ConfigOption[] });
        return;
      case "usage_update":
        return this.set({ usage: { used: Number(u.used) || 0, size: Number(u.size) || 0, cost: (u.cost as Usage["cost"]) ?? null } });
      case "session_info_update":
        if (typeof u.title === "string") this.set({ title: u.title });
        return;
    }
  }

  // session/new, session/load 的回包带 modes / models / configOptions; prompt 回包结束一轮
  private response(m: JsonRpc, at: number | undefined, seq: number): void {
    const r = obj(m.result);
    if (r.modes) this.set({ modes: r.modes as ModeState });
    if (r.models) this.set({ models: r.models as ModelState });
    if (Array.isArray(r.configOptions)) this.set({ config: r.configOptions as ConfigOption[] });
    const isPrompt = this.prompts.has(String(m.id)) || typeof r.stopReason === "string";
    if (m.error) this.addItem({ t: "error", key: `e${seq}`, msg: m.error.message, code: m.error.code, data: m.error.data }, seq, at);
    if (!isPrompt) return;
    this.prompts.delete(String(m.id));
    const n = this.view.turns.length;
    if (n === 0) return;
    const u = obj(r.usage);
    const usage: TurnUsage | undefined = r.usage
      ? { input: num(u.inputTokens), output: num(u.outputTokens), cacheRead: num(u.cachedReadTokens), cacheWrite: num(u.cachedWriteTokens), total: num(u.totalTokens) }
      : undefined;
    this.patchTurn(n - 1, (t) => ({ ...t, running: false, stop: str(r.stopReason) || (m.error ? "error" : undefined), end: at, usage }));
  }
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

// 工作组: 一轮里连续的工具与思考; 文字回答把它们隔开
export type Segment = { t: "group"; key: string; items: Item[] } | { t: "item"; item: Item };
const GROUPED = new Set(["tool", "thought"]);

export function segments(items: Item[]): Segment[] {
  const out: Segment[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (GROUPED.has(it.t)) {
      if (last?.t === "group") last.items.push(it);
      else out.push({ t: "group", key: `g${it.key}`, items: [it] });
    } else out.push({ t: "item", item: it });
  }
  return out;
}

// 同一文件连续同类操作合并成一行 (x N)
export type ToolRow = { key: string; kind: string; tools: Tool[] };
export function mergeTools(tools: Tool[]): ToolRow[] {
  const rows: ToolRow[] = [];
  for (const tool of tools) {
    const last = rows[rows.length - 1];
    const path = tool.locations[0]?.path;
    const lastTool = last?.tools[last.tools.length - 1];
    if (last && path && last.kind === tool.kind && (tool.kind === "read" || tool.kind === "edit") && lastTool?.locations[0]?.path === path) last.tools.push(tool);
    else rows.push({ key: tool.id, kind: tool.kind, tools: [tool] });
  }
  return rows;
}

export type DiffStat = { add: number; del: number };
export function diffStat(tool: Tool): DiffStat {
  let add = 0;
  let del = 0;
  for (const c of tool.content) {
    if (c.type !== "diff") continue;
    const d = lineDiff(c.oldText ?? "", c.newText);
    add += d.filter((l) => l.op === "+").length;
    del += d.filter((l) => l.op === "-").length;
  }
  return { add, del };
}

export type DiffLine = { op: "+" | "-" | " "; text: string };
const LCS_LIMIT = 4_000_000;

// 行级 LCS; 太大时退化成整段删除 + 整段新增
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a ? a.split("\n") : [];
  const y = b ? b.split("\n") : [];
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let ex = x.length;
  let ey = y.length;
  while (ex > s && ey > s && x[ex - 1] === y[ey - 1]) {
    ex--;
    ey--;
  }
  const head: DiffLine[] = x.slice(0, s).map((text) => ({ op: " ", text }));
  const tail: DiffLine[] = x.slice(ex).map((text) => ({ op: " ", text }));
  const xs = x.slice(s, ex);
  const ys = y.slice(s, ey);
  if (xs.length * ys.length > LCS_LIMIT) return [...head, ...xs.map((text) => ({ op: "-" as const, text })), ...ys.map((text) => ({ op: "+" as const, text })), ...tail];
  const w = ys.length + 1;
  const dp = new Uint32Array((xs.length + 1) * w);
  for (let i = xs.length - 1; i >= 0; i--) for (let j = ys.length - 1; j >= 0; j--) dp[i * w + j] = xs[i] === ys[j] ? (dp[(i + 1) * w + j + 1] as number) + 1 : Math.max(dp[(i + 1) * w + j] as number, dp[i * w + j + 1] as number);
  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < xs.length && j < ys.length) {
    if (xs[i] === ys[j]) {
      mid.push({ op: " ", text: xs[i] as string });
      i++;
      j++;
    } else if ((dp[(i + 1) * w + j] as number) >= (dp[i * w + j + 1] as number)) mid.push({ op: "-", text: xs[i++] as string });
    else mid.push({ op: "+", text: ys[j++] as string });
  }
  while (i < xs.length) mid.push({ op: "-", text: xs[i++] as string });
  while (j < ys.length) mid.push({ op: "+", text: ys[j++] as string });
  return [...head, ...mid, ...tail];
}

// 统一 diff 文本按文件切开
export type FileDiff = { path: string; lines: DiffLine[]; add: number; del: number };
export function parseUnified(text: string): FileDiff[] {
  const out: FileDiff[] = [];
  let cur: FileDiff | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = { path: line.replace(/^diff --git a\/(.*) b\/.*$/, "$1"), lines: [], add: 0, del: 0 };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("index ")) continue;
    if (line.startsWith("@@")) cur.lines.push({ op: " ", text: line });
    else if (line.startsWith("+")) {
      cur.add++;
      cur.lines.push({ op: "+", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      cur.del++;
      cur.lines.push({ op: "-", text: line.slice(1) });
    } else cur.lines.push({ op: " ", text: line.slice(1) });
  }
  return out;
}
