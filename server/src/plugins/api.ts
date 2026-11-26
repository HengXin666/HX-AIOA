import {
  MAX_CHAT_AGENTS,
  MAX_PLUGINS,
  PATH_PLUGIN,
  PATH_PLUGIN_INSTALL,
  PATH_PLUGIN_UPDATE,
  PATH_PLUGINS,
  isL2a,
  isPluginId,
  pluginChannel,
  resolvePluginId,
  type PluginDetail,
  type PluginEntry,
  type PluginManifest,
  type PluginInstall,
  type PluginInstalled,
  type PluginList,
} from "@hx-aioa/protocol";
import { agentBootstrap } from "../agent-prompt";
import { baseOf, createAgent, dropAgent } from "../api-chats";
import { CODE_BAD_REQUEST, CODE_CONFLICT, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, ERR_NO_RESOURCE, GET, PATCH, POST } from "../constants";
import { type Core, OWNER, ROOM, type ReqCtx, type Route, route } from "../core";
import { ApiFail, fail, json, readJson, pathParam } from "../http";
import { TODO_ROUTES } from "./api-todos";
import { usesGh } from "../gh/gate";
import { acctOf, isAdmin } from "./who";
import { L2A } from "./l2a";
import { renderTask } from "./store";
import { pushPlugin } from "./notify";
import { allowed, applySpace, autoUpgrade, upgrade } from "./update";

const param = (c: ReqCtx, i: number) => pathParam(c.params, i);
const notFound = () => fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);

// 改过 id 的插件 (todo -> hengxin666.todo) 旧路径照常能用
function pluginId(c: ReqCtx): string {
  const id = resolvePluginId(param(c, 0));
  if (!isPluginId(id)) throw new ApiFail(400, CODE_BAD_REQUEST, "插件 id 不合法");
  return id;
}

// 市场与详情主人和子号都能看; 安装记录 (群, Agent) 只属于主人, 只给主人看
function viewer(c: ReqCtx): string {
  const uid = acctOf(c.core, c.who);
  if (!uid || !(c.who.owner || c.who.member)) throw new ApiFail(403, CODE_FORBIDDEN, ERR_FORBIDDEN);
  return uid;
}

async function list(c: ReqCtx): Promise<Response> {
  const uid = viewer(c);
  if (c.who.owner) for (const p of c.core.plugins.list()) await autoUpgrade(c.core, p.id);
  const installed = new Map(c.who.owner ? c.core.plugins.list().map((p) => [p.id, p]) : []);
  // 主人看得到所有人的开发插件 (只能撤, 不能用)
  const allow = new Map(c.core.kernel.visible(uid, c.who.owner).map((a) => [a.id, a]));
  // 开发插件不在市场里, 单独列出 (只有开发者自己看得到)
  const devs = [...allow.values()].filter((a) => a.dev).map((a) => {
    const m = c.core.kernel.get(a.id)!.manifest;
    return { id: a.id, name: m.name, summary: m.summary, version: m.version, icon: m.icon, tags: m.tags, author: m.author, dev: true as const, ...(a.by !== uid ? { foreign: true as const } : {}) };
  });
  const admin = isAdmin(c.who);
  const on = (id: string) => !!uid && allow.has(id) && c.core.kernel.isEnabled(uid, id);
  const extra = (id: string) => ({ ...(installed.has(id) ? { installed: installed.get(id)! } : {}), ...(allow.has(id) ? { allowed: allow.get(id)! } : {}), ...(on(id) ? { enabled: true as const } : {}) });
  // 市场里没有 (连不上, 源被移除, 下架) 的放行与已安装插件也要列出来, 照样能看能撤能卸
  const leftover = (have: Set<string>) =>
    [...new Set([...installed.keys(), ...allow.keys()])].filter((id) => !allow.get(id)?.dev && !have.has(id)).map((id) => {
      const a = allow.get(id);
      const i = installed.get(id);
      const m = c.core.kernel.get(id)?.manifest;
      return { id, name: a?.name ?? i?.name ?? id, summary: m?.summary ?? "", version: a?.version ?? i?.version ?? "", ...(m?.icon ? { icon: m.icon } : {}) };
    });
  let index: PluginEntry[] = [];
  let error: string | undefined;
  try {
    index = (await c.core.market.index()).filter((p) => !allow.get(p.id)?.dev);
    error = c.core.market.errors().join("; ") || undefined;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const plugins = [...devs, ...index, ...leftover(new Set(index.map((p) => p.id)))].map((p) => ({ ...p, ...extra(p.id) }));
  return json({ plugins, ...(error ? { error } : {}), admin, owner: c.who.owner } satisfies PluginList);
}

const GONE_README = "市场里已经没有这个插件 (源被移除或下架), 这里显示的是放行时存下的版本。";

// 管理员看详情要看到市场最新版本: 只重拉所在源的索引, 文件按版本缓存; 子号全走缓存, 免得放大请求
const fromMarket = (c: ReqCtx, id: string) => c.core.market.manifest(id, isAdmin(c.who) ? "latest" : "cache");

async function detail(c: ReqCtx): Promise<Response> {
  const uid = viewer(c);
  const id = pluginId(c);
  const row = c.core.kernel.get(id);
  // 开发插件不在市场里: 开发者自己用它的快照; 别人看到的是市场内容 (没有就 404), 不暴露开发插件
  const own = row?.meta.dev ? row.meta.by === uid || c.who.owner : true;
  const foreign = !!row?.meta.dev && row.meta.by !== uid && c.who.owner;
  const devRow = row?.meta.dev && own ? row : undefined;
  // 市场里没了 (源被移除或下架) 但还在白名单: 用放行时存下的快照, 免得撤不掉也卸不了
  let snap = devRow;
  let fresh: PluginManifest | undefined;
  if (!snap) {
    try {
      fresh = await fromMarket(c, id);
    } catch (e) {
      if (!(row && !row.meta.dev && e instanceof ApiFail && e.status === 404)) throw e;
      snap = row;
    }
  }
  const gone = !!snap && !devRow;
  const manifest = snap?.manifest ?? fresh!;
  const src = snap ? undefined : await c.core.market.sourceOf(id).catch(() => undefined);
  const readme = snap ? (gone ? GONE_README : (snap.readme ?? "")) : await c.core.market.file(id, manifest.readme);
  // 第三方插件放行时要带上它, 证明管理员看过的就是要放行的那份
  const digest = src && !src.official && isAdmin(c.who) ? await c.core.market.digest(id) : undefined;
  if (c.who.owner) await autoUpgrade(c.core, id);
  const installed = c.who.owner ? c.core.plugins.get(id) : undefined;
  const allow = own ? row?.meta : undefined;
  const base = baseOf(c.url);
  const channel = installed?.channel ?? pluginChannel(id);
  const title = c.core.chats.chat(channel)?.title || manifest.group.title;
  const task = !manifest.agent
    ? undefined
    : installed
    ? c.core.plugins.promptFor(id, base, channel, title, usesGh(c.core, id))
    : renderTask(manifest.name, snap ? snap.prompt : await c.core.market.file(id, manifest.prompt), base, channel, title);
  const body: PluginDetail = {
    manifest,
    readme,
    readmeType: manifest.readme.endsWith(".html") ? "html" : "markdown",
    ...(installed ? { installed } : {}),
    ...(allow ? { allowed: allow } : {}),
    ...(task ? { task } : {}),
    admin: isAdmin(c.who),
    owner: c.who.owner,
    ...(foreign ? { foreign: true } : {}),
    ...(src && !src.official ? { source: src.name } : {}),
    ...(digest ? { digest } : {}),
    ...(gone ? { gone: true } : {}),
    ...(isL2a(id) && L2A[id].owner ? { deploy: true } : {}),
  };
  return json(body);
}

async function install(c: ReqCtx): Promise<Response> {
  const id = pluginId(c);
  if (c.core.plugins.get(id)) return fail(409, `插件 ${id} 已安装, 先卸载再装`, CODE_CONFLICT);
  if (c.core.plugins.list().length >= MAX_PLUGINS) return fail(400, `最多安装 ${MAX_PLUGINS} 个插件`);
  // 只装白名单里的快照版本, 不看市场当前版本; 别人的开发插件不能装
  const { manifest: m, prompt } = allowed(c.core, id);
  if (!c.core.kernel.usable(c.core.users.ownerId(), id)) return notFound();
  if (!m.agent) return fail(400, `插件 ${id} 没有 Agent, 不用安装, 启用即可`);
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
  const body = (await readJson(c.req)) as { auto?: unknown } | undefined;
  const id = pluginId(c);
  const rec = c.core.plugins.get(id);
  if (!rec) return notFound();
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
  route(GET, PATH_PLUGINS, ROOM, list),
  route(GET, PATH_PLUGIN, ROOM, detail),
  route(DELETE, PATH_PLUGIN, OWNER, uninstall),
  route(POST, PATH_PLUGIN_INSTALL, OWNER, install),
  route(POST, PATH_PLUGIN_UPDATE, OWNER, update),
  route(PATCH, PATH_PLUGIN, OWNER, settings),
  ...TODO_ROUTES,
];
