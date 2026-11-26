import { MAX_TODOS, TODO_STATES, parseTodoInput, type TodoItem, type TodoState } from "@hx-aioa/protocol";
import { CODE_FORBIDDEN, ERR_FORBIDDEN } from "../constants";
import type { ReqCtx } from "../core";
import { fail, json, readJson } from "../http";
import { syncTodos } from "./api-todos";
import { extChannel, extWritable } from "./ext";
import { dayOf, todosMarkdown } from "./todo-md";

// 最小的 MCP (Streamable HTTP, 只用 JSON 响应): initialize, tools/list, tools/call, ping
const PROTOCOL = "2025-06-18";
const SERVER = { name: "hx-aioa-todo", version: "1.0.0" };
const ACTIVE = "active";
type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; write?: boolean };

const STATE_HINT = "open 待进行, hold 挂起, doing 进行中, done 已完成";
const TODO_FIELDS = {
  title: { type: "string", description: "标题, 一句话" },
  note: { type: "string", description: "补充说明" },
  prio: { type: "integer", enum: [1, 2, 3], description: "1 急, 2 普通, 3 以后" },
  state: { type: "string", enum: TODO_STATES.filter((s) => s !== "dropped"), description: STATE_HINT },
  repo: { type: "string", description: "关联仓库 owner/name" },
  issue: { type: "integer", description: "关联的 issue 号" },
  parent: { type: "string", description: "父待办 id" },
  area: { type: "string", description: "分区: 生活 / 开发 / 工作 等短词" },
  due: { type: "integer", description: "截止时间, 毫秒时间戳" },
  remind: { type: "integer", description: "截止前几分钟提醒, 0 为到点 (要先有 due)" },
  alarm: { type: "boolean", description: "到点手机按闹钟持续响铃 (要先有 remind)" },
  star: { type: "boolean", description: "重点, 显示在总览" },
  every: { type: "object", description: "周期 {unit: day/week/month/year, n: 每几个单位, tz: 时区偏移分钟}, 完成后自动排下一期 (要先有 due)" },
};

const TOOLS: Tool[] = [
  {
    name: "list_todos",
    description: "列出待办 (Markdown, 按日期和仓库分组, 子待办缩进)。默认只列未完成的。",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: `active (默认, 未完成) / all / 或单个状态: ${STATE_HINT}` },
        repo: { type: "string", description: "只看这个仓库 owner/name" },
        days: { type: "integer", description: "只看最近 N 天创建的" },
      },
    },
  },
  { name: "add_todo", description: "新增一条待办, 返回它的 id。", write: true, inputSchema: { type: "object", properties: TODO_FIELDS, required: ["title"] } },
  {
    name: "update_todo",
    description: "按 id 修改待办 (状态, 标题, 关联 issue 等), 只传要改的字段。",
    write: true,
    inputSchema: { type: "object", properties: { id: { type: "string" }, ...TODO_FIELDS }, required: ["id"] },
  },
];

const ok = (id: Rpc["id"], result: unknown) => json({ jsonrpc: "2.0", id, result });
const err = (id: Rpc["id"], code: number, message: string) => json({ jsonrpc: "2.0", id, error: { code, message } });
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

function listTodos(c: ReqCtx, channel: string, a: Record<string, unknown>) {
  const state = typeof a.state === "string" ? a.state : ACTIVE;
  const days = typeof a.days === "number" && a.days > 0 ? a.days : 0;
  const since = days ? dayOf(Date.now() - days * 86_400_000) : "";
  let todos: TodoItem[] = c.core.todos.list(channel);
  if (typeof a.repo === "string" && a.repo) todos = todos.filter((t) => t.repo?.toLowerCase() === (a.repo as string).toLowerCase());
  if (since) todos = todos.filter((t) => dayOf(t.created) >= since);
  if (state !== ACTIVE && state !== "all") todos = todos.filter((t) => t.state === (state as TodoState));
  return text(todosMarkdown(c.core.chats.chat(channel)?.title || channel, todos, { all: state !== ACTIVE }));
}

function write(c: ReqCtx, channel: string, a: Record<string, unknown>, fresh: boolean) {
  const id = fresh ? `x-${Date.now().toString(36)}` : a.id;
  const input = parseTodoInput({ ...a, id });
  if (typeof input === "string") return text(input, true);
  if (fresh && c.core.todos.list(channel).length >= MAX_TODOS) return text(`最多 ${MAX_TODOS} 条待办`, true);
  if (!fresh && !c.core.todos.get(channel, input.id)) return text(`没有待办 ${input.id}`, true);
  const out = c.core.todos.upsert(channel, [input]);
  if (typeof out === "string") return text(out, true);
  if (out.rev) syncTodos(c.core, channel, out.rev);
  return text(fresh ? `已新增 ${input.id}` : out.rev ? `已更新 ${input.id}` : "没有变化");
}

export async function mcp(c: ReqCtx): Promise<Response> {
  const rpc = (await readJson(c.req)) as Rpc | undefined;
  const channel = extChannel(c);
  if (!channel) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  if (!rpc || typeof rpc.method !== "string") return err(null, -32600, "不是 JSON-RPC 请求");
  // 通知没有 id, 不回内容
  if (rpc.id === undefined) return new Response(null, { status: 202 });
  const writable = extWritable(c.who);
  switch (rpc.method) {
    case "initialize":
      return ok(rpc.id, { protocolVersion: String(rpc.params?.protocolVersion ?? PROTOCOL), capabilities: { tools: {} }, serverInfo: SERVER, instructions: "用户的待办清单。先 list_todos 再回答待办相关的问题。" });
    case "ping":
      return ok(rpc.id, {});
    case "tools/list":
      return ok(rpc.id, { tools: TOOLS.filter((t) => writable || !t.write).map(({ write: _w, ...t }) => t) });
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return err(rpc.id, -32602, `没有工具 ${name}`);
      if (tool.write && !writable) return ok(rpc.id, text("这把密钥只读", true));
      if (name === "list_todos") return ok(rpc.id, listTodos(c, channel, args));
      return ok(rpc.id, write(c, channel, args, name === "add_todo"));
    }
    default:
      return err(rpc.id, -32601, `不支持 ${rpc.method}`);
  }
}
