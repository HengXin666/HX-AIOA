import {
  PATH_PLUGIN_ALLOW,
  PATH_PLUGIN_ALLOW_LIST,
  PATH_PLUGIN_CHOICE,
  PATH_PLUGIN_CONTRIB,
  PATH_PLUGIN_ENABLED,
  CODE_NEEDS_DEPLOY,
  L2A_PLUGINS,
  OFFICIAL_SOURCE,
  PLUGIN_DAILY_BUDGET,
  SERVICE_PREFIX,
  cardOf,
  isExtPoint,
  isL2a,
  isPluginId,
  resolvePluginId,
  type PluginAllowInput,
  type PluginAllowView,
  type PluginContribView,
  type PluginManifest,
} from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_CONFLICT, CODE_PLUGIN_CONFLICT, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, ERR_NO_RESOURCE, GET, PUT } from "../constants";
import { ROOM, type ReqCtx, type Route, route } from "../core";
import { ApiFail, fail, json, readJson, pathParam } from "../http";
import type { AllowRow } from "./allow-store";
import { L2A, purgeL2a } from "./l2a";
import { dropDev } from "./api-dev";
import { teardown } from "./api";
import { pushPlugin } from "./notify";
import { CODE_NOT_ALLOWED, autoUpgrade } from "./update";
import { acctOf, isAdmin } from "./who";

const QUERY_PURGE = "purge";

const param = (c: ReqCtx, i: number) => pathParam(c.params, i);

function pluginParam(c: ReqCtx): string {
  const id = resolvePluginId(param(c, 0));
  if (!isPluginId(id)) throw new ApiFail(400, CODE_BAD_REQUEST, "插件 id 不合法");
  return id;
}

function acct(c: ReqCtx): string {
  const uid = acctOf(c.core, c.who);
  if (!uid || !(c.who.owner || c.who.member)) throw new ApiFail(403, CODE_FORBIDDEN, ERR_FORBIDDEN);
  return uid;
}

function admin(c: ReqCtx): string {
  const uid = acct(c);
  if (!isAdmin(c.who)) throw new ApiFail(403, CODE_FORBIDDEN, "只有管理员能放行或撤销插件");
  return uid;
}

function view(c: ReqCtx, uid: string): PluginAllowView {
  const k = c.core.kernel;
  const admin = isAdmin(c.who);
  return { allow: k.visible(uid), enabled: k.enabledOf(uid), choices: k.choicesFor(uid), budget: { total: k.check().total, limit: PLUGIN_DAILY_BUDGET }, admin, server: [...L2A_PLUGINS], dev: admin && k.devMode(uid) };
}

function getAllow(c: ReqCtx): Response {
  return json(view(c, acct(c)));
}

// 默认提供者只能是这个插件自己提供的单选扩展点或服务
function badDefault(m: PluginManifest, d: string): boolean {
  if (d.startsWith(SERVICE_PREFIX)) return !Object.hasOwn(m.provides ?? {}, d);
  return !(isExtPoint(d) && cardOf(d) === "single" && (m.contributes?.[d] ?? []).length > 0);
}

async function putAllow(c: ReqCtx): Promise<Response> {
  // 先读完请求体再判断, 提前拒绝时留着没读的流会卡住同一连接的下一个请求
  const body = ((await readJson(c.req)) ?? {}) as PluginAllowInput;
  const by = admin(c);
  const id = pluginParam(c);
  if (c.core.kernel.get(id)?.meta.dev) return fail(409, `${id} 被一个开发插件占用, 主人可以先撤销它`, CODE_CONFLICT);
  // 官方源放行绕过缓存拿最新; 第三方按管理员看过的那份 (digest) 放行, 内容变了就拒绝
  const cached = await c.core.market.sourceOf(id);
  const { m: manifest, src } = await c.core.market.manifestAt(id, cached.official ? "fresh" : "latest");
  const was = c.core.kernel.get(id)?.meta.source ?? OFFICIAL_SOURCE;
  // 换源等于换作者: 必须先撤销旧的再放行, 不能当成 "更新"
  if (c.core.kernel.get(id) && was !== src.id) return fail(409, `${id} 现在来自另一个市场源 (${src.name}), 先撤销旧的再放行`, CODE_CONFLICT);
  if (manifest.server && !isL2a(id)) return fail(409, `${id} 带服务端代码, 要先合进仓库并部署后才能放行`, CODE_NEEDS_DEPLOY);
  if (body.version && body.version !== manifest.version) return fail(409, `市场当前是 ${manifest.version}, 只能放行这个版本`, CODE_CONFLICT);
  const prompt = await c.core.market.file(id, manifest.prompt, src.official);
  if (src.official) {
    // 两次拉取之间市场可能换了版本, 再核对一次, 免得存下 "旧清单配新提示词"
    if ((await c.core.market.manifest(id, "fresh")).version !== manifest.version) return fail(409, "市场正在更新, 稍后再放行", CODE_CONFLICT);
  } else if (body.digest !== (await c.core.market.digest(id))) return fail(409, "插件内容和你在详情里看到的不一致, 重新打开详情再放行", CODE_CONFLICT);
  const defaults = Array.isArray(body.defaults) ? body.defaults.filter((d): d is string => typeof d === "string") : (c.core.kernel.get(id)?.meta.defaults ?? []);
  const bad = defaults.find((d) => badDefault(manifest, d));
  if (bad) return fail(400, `${id} 不提供单选扩展点或服务 ${bad}`);
  const row: AllowRow = { meta: { id, version: manifest.version, name: manifest.name, by, at: Date.now(), ...(defaults.length ? { defaults } : {}), ...(src.official ? {} : { source: src.id }) }, manifest, prompt };
  const result = c.core.kernel.check(row);
  if (result.conflicts.length) return fail(409, `${id} 与白名单冲突, 没有放行`, CODE_PLUGIN_CONFLICT, { conflicts: result.conflicts, requests: result.requests, total: result.total });
  const prev = c.core.kernel.get(id)?.meta.version;
  c.core.kernel.put(row);
  pushPlugin(c.core, id, prev ? "updated" : "allowed", { version: manifest.version });
  await autoUpgrade(c.core, id);
  return json({ allow: c.core.kernel.get(id)!.meta, requests: result.requests, total: result.total });
}

async function deleteAllow(c: ReqCtx): Promise<Response> {
  admin(c);
  const id = pluginParam(c);
  const row = c.core.kernel.get(id);
  if (!row) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  // 开发插件: 只有主人能撤别人的 (开发者被降级或删除后留下的也能清)
  if (row.meta.dev) {
    if (!c.who.owner) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
    await dropDev(c.core, row.meta.by, id);
    return json({ ok: true });
  }
  // 去掉它之后白名单也要能共存: 比如它是某单选扩展点的默认, 或别的插件依赖它提供的服务
  const after = c.core.kernel.check(undefined, id);
  if (after.conflicts.length) return fail(409, `撤销 ${id} 后白名单会冲突, 先给其它提供者指定默认或撤销依赖它的插件`, CODE_PLUGIN_CONFLICT, { conflicts: after.conflicts });
  c.core.kernel.revoke(id);
  await teardown(c.core, id);
  pushPlugin(c.core, id, "revoked");
  return json({ ok: true });
}

async function enable(c: ReqCtx): Promise<Response> {
  const uid = acct(c);
  const id = pluginParam(c);
  if (!c.core.kernel.usable(uid, id)) return fail(403, `插件 ${id} 还没被管理员放行`, CODE_NOT_ALLOWED);
  // 数据属于整个部署的服务端插件只看主人的启用, 子号开了也没用, 直接说清楚
  if (isL2a(id) && L2A[id].owner && uid !== c.core.users.ownerId()) return fail(400, `${id} 归整个部署, 只有主人启用才生效`);
  if (c.core.kernel.setEnabled(uid, id, true)) pushPlugin(c.core, id, "enabled", { uid, version: c.core.kernel.get(id)!.meta.version });
  return json(view(c, uid));
}

// 停用; ?purge=1 同时清掉这个账号在该插件下的全部数据。主人停用时一并拆掉 Agent 与工作台
async function disable(c: ReqCtx): Promise<Response> {
  const uid = acct(c);
  const id = pluginParam(c);
  const changed = c.core.kernel.setEnabled(uid, id, false);
  if (uid === c.core.users.ownerId()) await teardown(c.core, id);
  const purged = c.url.searchParams.get(QUERY_PURGE) === "1" ? c.core.pdata.purge(uid, id) + (await purgeL2a(c.core, uid, id)) : 0;
  if (changed) pushPlugin(c.core, id, "disabled", { uid });
  return json({ ...view(c, uid), purged });
}

async function choose(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as { plugin?: unknown } | undefined;
  const uid = acct(c);
  const point = param(c, 0);
  const plugin = typeof body?.plugin === "string" ? body.plugin : null;
  const err = c.core.kernel.choose(uid, point, plugin);
  if (err) return fail(400, err);
  return json(view(c, uid));
}

function contrib(c: ReqCtx): Response {
  const uid = acct(c);
  const point = param(c, 0);
  if (!isExtPoint(point)) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  const items = c.core.kernel.contributions(uid, point).map((e) => ({ ...e.c, plugin: e.plugin }));
  return json({ point, card: cardOf(point), items } satisfies PluginContribView);
}

export const ALLOW_ROUTES: Route[] = [
  route(GET, PATH_PLUGIN_CONTRIB, ROOM, contrib),
  route(GET, PATH_PLUGIN_ALLOW_LIST, ROOM, getAllow),
  route(PUT, PATH_PLUGIN_ALLOW, ROOM, putAllow),
  route(DELETE, PATH_PLUGIN_ALLOW, ROOM, deleteAllow),
  route(PUT, PATH_PLUGIN_ENABLED, ROOM, enable),
  route(DELETE, PATH_PLUGIN_ENABLED, ROOM, disable),
  route(PUT, PATH_PLUGIN_CHOICE, ROOM, choose),
];

