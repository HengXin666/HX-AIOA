import type { AgentMessage, AgentPart, MessageStatus, ToolCallData, ToolStatus } from "@hx/ui/agent";
import type { Item, Tool, Turn } from "./reduce";
import type { ContentBlock } from "./types";

// ACP 时间线 (reduce.ts 的轮与项) -> HX-UI Agent 界面的消息模型; 工具按 ACP ToolKind 映射到 HX-UI 内置视图的名字与参数
const KIND_NAME: Record<string, string> = { read: "read", edit: "edit", delete: "delete", move: "move", search: "grep", execute: "bash", fetch: "web_fetch", think: "think" };
const STATUS: Record<string, ToolStatus> = { pending: "running", in_progress: "running", completed: "success", failed: "error" };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function textsOf(t: Tool): string {
  return t.content.flatMap((c) => (c.type === "content" && c.content.type === "text" && c.content.text ? [c.content.text] : [])).join("\n");
}

function argsOf(t: Tool, cwd?: string): Record<string, unknown> {
  const raw = obj(t.rawInput);
  const path = t.locations[0]?.path ?? str(raw.file_path) ?? str(raw.path);
  const rel = path && cwd && path.startsWith(cwd) ? path.slice(cwd.length).replace(/^\//, "") : path;
  switch (t.kind) {
    case "execute":
      return { ...raw, command: str(raw.command) ?? str(raw.cmd) ?? t.title };
    case "edit": {
      const diffs = t.content.flatMap((c) => (c.type === "diff" ? [c] : []));
      if (diffs.length === 1) {
        const d = diffs[0] as Extract<Tool["content"][number], { type: "diff" }>;
        return { file_path: d.path, old_string: d.oldText ?? "", new_string: d.newText };
      }
      if (diffs.length > 1) return { file_path: rel, edits: diffs.map((d) => ({ old_string: d.oldText ?? "", new_string: d.newText })) };
      return { ...raw, file_path: rel };
    }
    case "search":
      return { ...raw, pattern: str(raw.pattern) ?? str(raw.query) ?? t.title };
    case "fetch":
      return { ...raw, url: str(raw.url) ?? t.title };
    default:
      return { ...raw, ...(rel ? { file_path: rel } : {}), title: t.title };
  }
}

export function toolCall(t: Tool, cwd?: string): ToolCallData {
  const out = textsOf(t);
  const status = STATUS[t.status] ?? "running";
  return {
    id: t.id,
    name: KIND_NAME[t.kind] ?? (t.title || "tool"),
    status,
    args: argsOf(t, cwd),
    output: t.kind === "execute" ? out || undefined : undefined,
    result: t.rawOutput ?? (out || undefined),
    error: status === "error" ? out || str(obj(t.rawOutput).error) || "失败" : undefined,
    startedAt: t.start,
    endedAt: t.end,
    meta: { acp: t, title: t.title, kind: t.kind },
  };
}

function itemPart(it: Item, cwd?: string, live = false): AgentPart | null {
  switch (it.t) {
    case "msg":
      return { type: "text", id: it.key, text: it.text, streaming: live };
    case "thought":
      return { type: "reasoning", id: it.key, text: it.text, startedAt: it.start, endedAt: it.end, streaming: live && !it.end };
    case "tool":
      return { type: "tool", id: it.key, call: toolCall(it.tool, cwd) };
    case "plan":
      return { type: "tool", id: it.key, call: { id: it.key, name: "todo_write", status: "success", args: { todos: it.entries.map((e) => ({ content: e.content, status: e.status })) } } };
    case "error":
      return { type: "notice", id: it.key, kind: "error", text: it.msg, detail: it.code !== undefined ? String(it.code) : undefined };
    case "note":
      return { type: "notice", id: it.key, kind: "info", text: it.text };
  }
}

function userParts(blocks: ContentBlock[], key: string): AgentPart[] {
  return blocks.flatMap((b, i): AgentPart[] => {
    const id = `${key}-u${i}`;
    if (b.type === "text" && b.text) return [{ type: "text", id, text: b.text }];
    if (b.type === "image" && b.data) return [{ type: "file", id, name: b.name ?? "图片", mediaType: b.mimeType, url: `data:${b.mimeType};base64,${b.data}` }];
    if (b.type === "resource_link" || b.type === "resource") return [{ type: "file", id, name: b.name ?? b.uri ?? b.resource?.uri ?? "文件", mediaType: b.mimeType }];
    return [];
  });
}

function statusOf(t: Turn): MessageStatus {
  if (t.running) return "streaming";
  if (t.stop === "cancelled") return "stopped";
  if (t.items.some((i) => i.t === "error")) return "error";
  return "done";
}

// 归约器只替换改到的轮, 按轮缓存让没变的消息保持同一引用 (MessageList 按引用跳过重渲染)
const cache = new WeakMap<Turn, { cwd?: string; msgs: AgentMessage[] }>();

export function toMessages(turns: Turn[], cwd?: string): AgentMessage[] {
  return turns.flatMap((t) => {
    const hit = cache.get(t);
    if (hit && hit.cwd === cwd) return hit.msgs;
    const msgs = turnMessages(t, cwd);
    cache.set(t, { cwd, msgs });
    return msgs;
  });
}

function turnMessages(t: Turn, cwd?: string): AgentMessage[] {
  const out: AgentMessage[] = [];
  if (t.user) out.push({ id: `${t.key}-u`, role: "user", parts: userParts(t.user, t.key), createdAt: t.start, status: "done" });
  const last = t.items.length - 1;
  const parts = t.items.flatMap((it, i) => itemPart(it, cwd, t.running && i === last) ?? []);
  if (parts.length === 0 && !t.running) return out;
  const u = t.usage;
  out.push({
    id: `${t.key}-a`,
    role: "assistant",
    parts,
    status: statusOf(t),
    startedAt: t.start,
    endedAt: t.end,
    usage: u ? { inputTokens: (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0), outputTokens: u.output, cachedInputTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite } : undefined,
  });
  return out;
}
