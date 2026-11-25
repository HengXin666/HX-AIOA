import { MAX_TODO_BATCH, PATH_TODO, PATH_TODOS, PATH_TODOS_SYNC, TODO_COLL, TODO_PLUGIN, TODO_SYNC_TOPIC, parseTodoInput, type ChatSyncFrame, type TodoInput } from "@hx-aioa/protocol";
import { canRead } from "../api-chats";
import { CODE_BAD_REQUEST, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, ERR_NO_RESOURCE, GET, POST } from "../constants";
import { type Core, type Principal, type ReqCtx, ROOM, type Route, route } from "../core";
import { ApiFail, fail, json, readJson } from "../http";
import { rank, roleIn } from "../room-access";
import { maybeSync, syncTodoIssues } from "../gh/todo-sync";
import { pushPData } from "./notify";
import { acctOf } from "./who";

const ADMIN_RANK = rank("admin");

function param(c: ReqCtx, i: number): string {
  try {
    return decodeURIComponent(c.params[i] ?? "");
  } catch {
    throw new ApiFail(400, CODE_BAD_REQUEST, "路径参数编码不合法");
  }
}

// 群里接入的 Agent: key 白名单第一项就是它所在的群; 外部接入 key 另算
const homeAgent = (who: Principal, channel: string) => !who.owner && !who.member && !who.key.ext && who.key.channels[0] === channel;
const extKey = (who: Principal, channel: string) => !who.owner && !who.member && !!who.key.ext && who.key.channels[0] === channel;
// 主人, 群管理员, 本群 Agent, 可写的外部接入 key 能改待办
export function canWriteTodos(core: Core, who: Principal, channel: string): boolean {
  if (homeAgent(who, channel)) return true;
  if (extKey(who, channel)) return !who.owner && who.key.ext === "write";
  const role = roleIn(core, who, channel);
  return role !== null && rank(role) >= ADMIN_RANK;
}

// 按调用者自己的账号判断是否启用 (之前误查主人的); 普通 Agent 的 key 由主人发放, 算主人账号
// key (群 Agent, 插件 Agent, 外部接入) 都由主人发放, 直接按主人判断, 不用查是哪个插件的
const todoOff = (c: ReqCtx) => !c.core.kernel.isEnabled(c.who.owner || c.who.member ? (acctOf(c.core, c.who) ?? c.core.users.ownerId()) : c.core.users.ownerId(), TODO_PLUGIN);

/** 旧客户端只认 chat_sync: 收到后重拉该群待办。 */
export function legacyTodoSync(core: Core, channel: string): void {
  core.sockets.toAllClients({ t: "chat_sync", topic: TODO_SYNC_TOPIC, channel } satisfies ChatSyncFrame);
}

/** 待办变了: 新客户端收 pdata_sync 按 rev 增量拉, 旧客户端收 chat_sync 重拉该群。 */
export function syncTodos(core: Core, channel: string, rev: number): void {
  pushPData(core, core.users.ownerId(), TODO_PLUGIN, TODO_COLL, rev);
  legacyTodoSync(core, channel);
}

function getTodos(c: ReqCtx): Response {
  if (todoOff(c)) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  const channel = param(c, 0);
  if (!canRead(c.core, c.who, channel) && !homeAgent(c.who, channel) && !extKey(c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  maybeSync(c.core);
  return json({ todos: c.core.todos.list(channel) });
}

// 立即同步关联的 issue (下拉刷新用)
async function syncNow(c: ReqCtx): Promise<Response> {
  if (todoOff(c)) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  const channel = param(c, 0);
  if (!canWriteTodos(c.core, c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const changed = await syncTodoIssues(c.core);
  return json({ changed, todos: c.core.todos.list(channel) });
}

async function postTodos(c: ReqCtx): Promise<Response> {
  // 先读完请求体再判断, 提前返回时留着没读的流会影响同一连接的下一个请求
  const body = (await readJson(c.req)) as { todos?: unknown } | undefined;
  if (todoOff(c)) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  const channel = param(c, 0);
  if (!canWriteTodos(c.core, c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const raw = Array.isArray(body?.todos) ? body.todos : [body];
  if (!raw.length || raw.length > MAX_TODO_BATCH) return fail(400, `一次 1 到 ${MAX_TODO_BATCH} 条`);
  const inputs: TodoInput[] = [];
  for (const [i, r] of raw.entries()) {
    const p = parseTodoInput(r);
    if (typeof p === "string") return fail(400, `第 ${i + 1} 条: ${p}`);
    inputs.push(p);
  }
  const out = c.core.todos.upsert(channel, inputs);
  if (typeof out === "string") return fail(400, out);
  if (out.rev) syncTodos(c.core, channel, out.rev);
  return json({ todos: out.todos });
}

function deleteTodo(c: ReqCtx): Response {
  if (todoOff(c)) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  const channel = param(c, 0);
  if (!canWriteTodos(c.core, c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const rev = c.core.todos.remove(channel, param(c, 1));
  if (!rev) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  syncTodos(c.core, channel, rev);
  return json({ ok: true });
}

// 旧待办接口: 转发到 pdata, 保留一个大版本, 之后删除
export const TODO_ROUTES: Route[] = [route(GET, PATH_TODOS, ROOM, getTodos), route(POST, PATH_TODOS, ROOM, postTodos), route(DELETE, PATH_TODO, ROOM, deleteTodo), route(POST, PATH_TODOS_SYNC, ROOM, syncNow)];
