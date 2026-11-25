import {
  MAX_CHAT_AGENTS,
  MAX_PLUGINS,
  MAX_TODO_BATCH,
  PATH_PLUGIN,
  PATH_PLUGIN_INSTALL,
  PATH_PLUGIN_UPDATE,
  PATH_PLUGINS,
  PATH_TODO,
  PATH_TODOS,
  PATH_TODOS_SYNC,
  GH_PLUGIN_ID,
  PLUGIN_CHANNEL_PREFIX,
  TODO_SYNC_TOPIC,
  isPluginId,
  parseTodoInput,
  type ChatSyncFrame,
  type PluginDetail,
  type PluginInstall,
  type PluginInstalled,
  type PluginList,
  type TodoInput,
} from "@hx-aioa/protocol";
import { agentBootstrap } from "../agent-prompt";
import { baseOf, canRead, createAgent, dropAgent } from "../api-chats";
import { CODE_CONFLICT, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, ERR_NO_RESOURCE, GET, PATCH, POST } from "../constants";
import { type Core, OWNER, type Principal, type ReqCtx, ROOM, type Route, route } from "../core";
import { ApiFail, fail, json, readJson } from "../http";
import { rank, roleIn } from "../room-access";
import { renderTask } from "./store";
import { applySpace, autoUpgrade, upgrade } from "./update";
import { maybeSync, syncTodoIssues } from "../gh/todo-sync";

const param = (c: ReqCtx, i: number) => decodeURIComponent(c.params[i] ?? "");
const notFound = () => fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
const ADMIN_RANK = rank("admin");

function pluginId(c: ReqCtx): string {
  const id = param(c, 0);
  if (!isPluginId(id)) throw new ApiFail(400, "bad_request", "插件 id 不合法");
  return id;
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

function syncTodos(core: Core, channel: string): void {
  core.sockets.toAllClients({ t: "chat_sync", topic: TODO_SYNC_TOPIC, channel } satisfies ChatSyncFrame);
}

async function list(c: ReqCtx): Promise<Response> {
  let installed = new Map(c.core.plugins.list().map((p) => [p.id, p]));
  try {
    const index = await c.core.market.index();
    // 打开市场时顺手做自动更新, 列表里看到的就是更新后的状态
    const stale = index.filter((p) => installed.has(p.id) && installed.get(p.id)!.version !== p.version);
    if (stale.length) {
      for (const p of stale) await autoUpgrade(c.core, p.id, p.version);
      installed = new Map(c.core.plugins.list().map((p) => [p.id, p]));
    }
    const plugins = index.map((p) => ({ ...p, ...(installed.has(p.id) ? { installed: installed.get(p.id)! } : {}) }));
    return json({ plugins } satisfies PluginList);
  } catch (e) {
    // 市场连不上时已安装的照样能看能卸
    const plugins = [...installed.values()].map((i) => ({ id: i.id, name: i.name, summary: "", version: i.version, installed: i }));
    return json({ plugins, error: e instanceof Error ? e.message : String(e) } satisfies PluginList);
  }
}

async function detail(c: ReqCtx): Promise<Response> {
  const id = pluginId(c);
  const manifest = await c.core.market.manifest(id, true);
  const readme = await c.core.market.file(id, manifest.readme);
  await autoUpgrade(c.core, id, manifest.version);
  const installed = c.core.plugins.get(id);
  const base = baseOf(c.url);
  const channel = installed?.channel ?? `${PLUGIN_CHANNEL_PREFIX}${id}`;
  const title = c.core.chats.chat(channel)?.title || manifest.group.title;
  const task = manifest.base
    ? undefined
    : installed
    ? c.core.plugins.promptFor(id, base, channel, title)
    : renderTask(manifest.name, await c.core.market.file(id, manifest.prompt), base, channel, title);
  const body: PluginDetail = {
    manifest,
    readme,
    readmeType: manifest.readme.endsWith(".html") ? "html" : "markdown",
    ...(installed ? { installed } : {}),
    ...(task ? { task } : {}),
  };
  return json(body);
}

async function install(c: ReqCtx): Promise<Response> {
  const id = pluginId(c);
  if (c.core.plugins.get(id)) return fail(409, `插件 ${id} 已安装, 先卸载再装`, CODE_CONFLICT);
  if (c.core.plugins.list().length >= MAX_PLUGINS) return fail(400, `最多安装 ${MAX_PLUGINS} 个插件`);
  const m = await c.core.market.manifest(id);
  const missing = (m.deps ?? []).filter((d) => !d.optional && !c.core.plugins.get(d.id));
  if (missing.length) return fail(400, `先安装依赖: ${missing.map((d) => d.id).join(", ")}`);
  const prompt = await c.core.market.file(id, m.prompt);
  const deps = (m.deps ?? []).map((d) => d.id);
  // base 插件只记安装, 不建群不发 key
  if (m.base) {
    const rec: PluginInstall = { id, version: m.version, name: m.name, channel: "", keyId: "", installed: Date.now(), base: true, ...(deps.length ? { deps } : {}) };
    c.core.plugins.save(rec, m.name, prompt);
    return json({ install: rec, prompt: "", key: "" } satisfies PluginInstalled);
  }
  const channel = `${PLUGIN_CHANNEL_PREFIX}${id}`;
  const meta = c.core.chats.chat(channel);
  if ((meta?.agents ?? []).length >= MAX_CHAT_AGENTS) return fail(400, `群 ${channel} 的 Agent 已满`);
  if (!meta?.title) c.core.chats.patchChat(channel, { title: m.group.title });
  const title = c.core.chats.chat(channel)?.title || m.group.title;
  const space = await applySpace(c.core, id, m, channel, title);
  const { agent, key } = await createAgent(c.core, channel, m.agent.name, [channel], id);
  const rec: PluginInstall = { id, version: m.version, name: m.name, channel, keyId: agent.keyId, installed: Date.now(), ...(space ? { space } : {}), ...(deps.length ? { deps } : {}) };
  const job = { interval: m.agent.interval, task: m.agent.task };
  c.core.plugins.save(rec, m.name, prompt, job);
  return json({ install: rec, prompt: agentBootstrap(baseOf(c.url), title, key, job), key } satisfies PluginInstalled);
}

// 手动更新: 不看自动开关, 版本一样也重新拉一遍 (市场缓存最多 5 分钟)
async function update(c: ReqCtx): Promise<Response> {
  return json({ install: await upgrade(c.core, pluginId(c)) });
}

// 设置: 目前只有自动更新开关
async function settings(c: ReqCtx): Promise<Response> {
  const id = pluginId(c);
  const rec = c.core.plugins.get(id);
  if (!rec) return notFound();
  const body = (await readJson(c.req)) as { auto?: unknown } | undefined;
  if (typeof body?.auto !== "boolean") return fail(400, "需要 { \"auto\": true | false }");
  const next: PluginInstall = { ...rec, auto: body.auto };
  c.core.plugins.setInstall(next);
  return json({ install: next });
}

// 卸载: 去掉 Agent 与工作台; 群里的消息和待办留着, 重新安装还能接上
async function uninstall(c: ReqCtx): Promise<Response> {
  const id = pluginId(c);
  const rec = c.core.plugins.get(id);
  if (!rec) return notFound();
  // 卸 GitHub 授权就把令牌一起删掉
  if (id === GH_PLUGIN_ID) c.core.gh.revoke();
  if (rec.channel && c.core.chats.chat(rec.channel)?.agents?.some((a) => a.keyId === rec.keyId)) dropAgent(c.core, rec.channel, rec.keyId);
  if (rec.space && (await c.core.spaces.remove(rec.space))) c.core.sockets.toV1Clients({ t: "space_update", id: rec.space, deleted: true });
  c.core.plugins.remove(id);
  return json({ ok: true });
}

function getTodos(c: ReqCtx): Response {
  const channel = param(c, 0);
  if (!canRead(c.core, c.who, channel) && !homeAgent(c.who, channel) && !extKey(c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  maybeSync(c.core);
  return json({ todos: c.core.todos.list(channel) });
}

async function postTodos(c: ReqCtx): Promise<Response> {
  const channel = param(c, 0);
  if (!canWriteTodos(c.core, c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const body = (await readJson(c.req)) as { todos?: unknown } | undefined;
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
  if (out.length) syncTodos(c.core, channel);
  return json({ todos: out });
}

// 立即同步关联的 issue (下拉刷新用)
async function syncNow(c: ReqCtx): Promise<Response> {
  const channel = param(c, 0);
  if (!canWriteTodos(c.core, c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const changed = await syncTodoIssues(c.core);
  return json({ changed, todos: c.core.todos.list(channel) });
}

function deleteTodo(c: ReqCtx): Response {
  const channel = param(c, 0);
  if (!canWriteTodos(c.core, c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const ok = c.core.todos.remove(channel, param(c, 1));
  if (!ok) return notFound();
  syncTodos(c.core, channel);
  return json({ ok });
}

export const PLUGIN_ROUTES: Route[] = [
  route(GET, PATH_PLUGINS, OWNER, list),
  route(GET, PATH_PLUGIN, OWNER, detail),
  route(DELETE, PATH_PLUGIN, OWNER, uninstall),
  route(POST, PATH_PLUGIN_INSTALL, OWNER, install),
  route(POST, PATH_PLUGIN_UPDATE, OWNER, update),
  route(PATCH, PATH_PLUGIN, OWNER, settings),
  route(GET, PATH_TODOS, ROOM, getTodos),
  route(POST, PATH_TODOS, ROOM, postTodos),
  route(DELETE, PATH_TODO, ROOM, deleteTodo),
  route(POST, PATH_TODOS_SYNC, ROOM, syncNow),
];
