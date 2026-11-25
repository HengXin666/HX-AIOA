import {
  MAX_CHAT_AGENTS,
  MAX_PLUGINS,
  PATH_PLUGIN,
  PATH_PLUGIN_INSTALL,
  PATH_PLUGIN_UPDATE,
  PATH_PLUGINS,
  isPluginId,
  pluginChannel,
  resolvePluginId,
  type PluginDetail,
  type PluginInstall,
  type PluginInstalled,
  type PluginList,
} from "@hx-aioa/protocol";
import { agentBootstrap } from "../agent-prompt";
import { baseOf, createAgent, dropAgent } from "../api-chats";
import { CODE_BAD_REQUEST, CODE_CONFLICT, CODE_NOT_FOUND, DELETE, ERR_NO_RESOURCE, GET, PATCH, POST } from "../constants";
import { type Core, OWNER, type ReqCtx, type Route, route } from "../core";
import { ApiFail, fail, json, readJson } from "../http";
import { TODO_ROUTES } from "./api-todos";
import { renderTask } from "./store";
import { pushPlugin } from "./notify";
import { allowed, applySpace, autoUpgrade, upgrade } from "./update";

function param(c: ReqCtx, i: number): string {
  try {
    return decodeURIComponent(c.params[i] ?? "");
  } catch {
    throw new ApiFail(400, CODE_BAD_REQUEST, "路径参数编码不合法");
  }
}
const notFound = () => fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);

// 改过 id 的插件 (todo -> hengxin666.todo) 旧路径照常能用
function pluginId(c: ReqCtx): string {
  const id = resolvePluginId(param(c, 0));
  if (!isPluginId(id)) throw new ApiFail(400, CODE_BAD_REQUEST, "插件 id 不合法");
  return id;
}

async function list(c: ReqCtx): Promise<Response> {
  for (const p of c.core.plugins.list()) await autoUpgrade(c.core, p.id);
  const installed = new Map(c.core.plugins.list().map((p) => [p.id, p]));
  const allow = new Map(c.core.kernel.list().map((a) => [a.id, a]));
  const extra = (id: string) => ({ ...(installed.has(id) ? { installed: installed.get(id)! } : {}), ...(allow.has(id) ? { allowed: allow.get(id)! } : {}) });
  try {
    const index = await c.core.market.index();
    return json({ plugins: index.map((p) => ({ ...p, ...extra(p.id) })) } satisfies PluginList);
  } catch (e) {
    // 市场连不上时, 白名单与已安装的照样能看能装能卸
    const ids = new Set([...installed.keys(), ...allow.keys()]);
    const plugins = [...ids].map((id) => {
      const a = allow.get(id);
      const i = installed.get(id);
      return { id, name: a?.name ?? i?.name ?? id, summary: "", version: a?.version ?? i?.version ?? "", ...extra(id) };
    });
    return json({ plugins, error: e instanceof Error ? e.message : String(e) } satisfies PluginList);
  }
}

async function detail(c: ReqCtx): Promise<Response> {
  const id = pluginId(c);
  const manifest = await c.core.market.manifest(id, true);
  const readme = await c.core.market.file(id, manifest.readme);
  await autoUpgrade(c.core, id);
  const installed = c.core.plugins.get(id);
  const allow = c.core.kernel.get(id)?.meta;
  const base = baseOf(c.url);
  const channel = installed?.channel ?? pluginChannel(id);
  const title = c.core.chats.chat(channel)?.title || manifest.group.title;
  const task = installed
    ? c.core.plugins.promptFor(id, base, channel, title)
    : renderTask(manifest.name, await c.core.market.file(id, manifest.prompt), base, channel, title);
  const body: PluginDetail = {
    manifest,
    readme,
    readmeType: manifest.readme.endsWith(".html") ? "html" : "markdown",
    ...(installed ? { installed } : {}),
    ...(allow ? { allowed: allow } : {}),
    ...(task ? { task } : {}),
    admin: true,
  };
  return json(body);
}

async function install(c: ReqCtx): Promise<Response> {
  const id = pluginId(c);
  if (c.core.plugins.get(id)) return fail(409, `插件 ${id} 已安装, 先卸载再装`, CODE_CONFLICT);
  if (c.core.plugins.list().length >= MAX_PLUGINS) return fail(400, `最多安装 ${MAX_PLUGINS} 个插件`);
  // 只装白名单里的快照版本, 不看市场当前版本
  const { manifest: m, prompt } = allowed(c.core, id);
  const channel = pluginChannel(id);
  const meta = c.core.chats.chat(channel);
  if ((meta?.agents ?? []).length >= MAX_CHAT_AGENTS) return fail(400, `群 ${channel} 的 Agent 已满`);
  if (!meta?.title) c.core.chats.patchChat(channel, { title: m.group.title });
  const title = c.core.chats.chat(channel)?.title || m.group.title;
  const space = await applySpace(c.core, id, m, channel, title);
  const { agent, key } = await createAgent(c.core, channel, m.agent.name, [channel], id);
  // 等待期间可能被撤销放行或换了版本: 撤销就回滚刚建的 Agent 与工作台
  if (c.core.kernel.get(id)?.meta.version !== m.version) {
    dropAgent(c.core, channel, agent.keyId);
    if (space && (await c.core.spaces.remove(space))) c.core.sockets.toV1Clients({ t: "space_update", id: space, deleted: true });
    return fail(409, `插件 ${id} 在安装期间被撤销或换了版本, 请重试`, CODE_CONFLICT);
  }
  const rec: PluginInstall = { id, version: m.version, name: m.name, channel, keyId: agent.keyId, installed: Date.now(), ...(space ? { space } : {}) };
  const job = { interval: m.agent.interval, task: m.agent.task };
  c.core.plugins.save(rec, m.name, prompt, job);
  const uid = c.core.users.ownerId();
  if (c.core.kernel.setEnabled(uid, id, true)) pushPlugin(c.core, id, "enabled", { uid, version: m.version });
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

// 卸载: 去掉 Agent 与工作台; 群里的消息和数据留着, 重新安装还能接上
export async function teardown(core: Core, id: string): Promise<boolean> {
  const rec = core.plugins.get(id);
  if (!rec) return false;
  if (core.chats.chat(rec.channel)?.agents?.some((a) => a.keyId === rec.keyId)) dropAgent(core, rec.channel, rec.keyId);
  if (rec.space && (await core.spaces.remove(rec.space))) core.sockets.toV1Clients({ t: "space_update", id: rec.space, deleted: true });
  core.plugins.remove(id);
  return true;
}

async function uninstall(c: ReqCtx): Promise<Response> {
  const id = pluginId(c);
  if (!(await teardown(c.core, id))) return notFound();
  const uid = c.core.users.ownerId();
  if (c.core.kernel.setEnabled(uid, id, false)) pushPlugin(c.core, id, "disabled", { uid });
  return json({ ok: true });
}

export const PLUGIN_ROUTES: Route[] = [
  route(GET, PATH_PLUGINS, OWNER, list),
  route(GET, PATH_PLUGIN, OWNER, detail),
  route(DELETE, PATH_PLUGIN, OWNER, uninstall),
  route(POST, PATH_PLUGIN_INSTALL, OWNER, install),
  route(POST, PATH_PLUGIN_UPDATE, OWNER, update),
  route(PATCH, PATH_PLUGIN, OWNER, settings),
  ...TODO_ROUTES,
];
