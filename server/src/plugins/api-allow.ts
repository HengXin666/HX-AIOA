import {
  PATH_PLUGIN_ALLOW,
  PATH_PLUGIN_ALLOW_LIST,
  PATH_PLUGIN_CHOICE,
  PATH_PLUGIN_ENABLED,
  PLUGIN_DAILY_BUDGET,
  cardOf,
  isExtPoint,
  isPluginId,
  type PluginAllowInput,
  type PluginAllowView,
  type PluginManifest,
} from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_CONFLICT, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, ERR_NO_RESOURCE, GET, PUT } from "../constants";
import { ROOM, type ReqCtx, type Route, route } from "../core";
import { ApiFail, fail, json, readJson } from "../http";
import type { AllowRow } from "./allow-store";
import { teardown } from "./api";
import { pushPlugin } from "./notify";
import { CODE_NOT_ALLOWED, autoUpgrade } from "./update";
import { acctOf, isAdmin } from "./who";

const CODE_PLUGIN_CONFLICT = "plugin_conflict";
const QUERY_PURGE = "purge";

function param(c: ReqCtx, i: number): string {
  return decodeURIComponent(c.params[i] ?? "");
}

function pluginParam(c: ReqCtx): string {
  const id = param(c, 0);
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
  return { allow: k.list(), enabled: k.enabledOf(uid), choices: k.choicesFor(uid), budget: { total: k.check().total, limit: PLUGIN_DAILY_BUDGET }, admin: isAdmin(c.who) };
}

function getAllow(c: ReqCtx): Response {
  return json(view(c, acct(c)));
}

// 默认提供者只能是这个插件自己提供的单选扩展点或服务
function badDefault(m: PluginManifest, d: string): boolean {
  if (d.startsWith("service:")) return !Object.hasOwn(m.provides ?? {}, d);
  return !(isExtPoint(d) && cardOf(d) === "single" && (m.contributes?.[d] ?? []).length > 0);
}

async function putAllow(c: ReqCtx): Promise<Response> {
  const by = admin(c);
  const id = pluginParam(c);
  const body = ((await readJson(c.req)) ?? {}) as PluginAllowInput;
  // 放行是管理员主动操作, 绕过市场缓存
  const manifest = await c.core.market.manifest(id, true);
  if (body.version && body.version !== manifest.version) return fail(409, `市场当前是 ${manifest.version}, 只能放行这个版本`, CODE_CONFLICT);
  const defaults = Array.isArray(body.defaults) ? body.defaults.filter((d): d is string => typeof d === "string") : (c.core.kernel.get(id)?.meta.defaults ?? []);
  const bad = defaults.find((d) => badDefault(manifest, d));
  if (bad) return fail(400, `${id} 不提供单选扩展点或服务 ${bad}`);
  const prompt = await c.core.market.file(id, manifest.prompt, true);
  const row: AllowRow = { meta: { id, version: manifest.version, name: manifest.name, by, at: Date.now(), ...(defaults.length ? { defaults } : {}) }, manifest, prompt };
  const result = c.core.kernel.check(row);
  if (result.conflicts.length) return fail(409, `${id} 与白名单冲突, 没有放行`, CODE_PLUGIN_CONFLICT, { conflicts: result.conflicts, requests: result.requests, total: result.total });
  const was = c.core.kernel.get(id)?.meta.version;
  c.core.kernel.put(row);
  pushPlugin(c.core, id, was ? "updated" : "allowed", { version: manifest.version });
  await autoUpgrade(c.core, id);
  return json({ allow: c.core.kernel.get(id)!.meta, requests: result.requests, total: result.total });
}

async function deleteAllow(c: ReqCtx): Promise<Response> {
  admin(c);
  const id = pluginParam(c);
  if (!c.core.kernel.get(id)) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  c.core.kernel.revoke(id);
  await teardown(c.core, id);
  pushPlugin(c.core, id, "revoked");
  return json({ ok: true });
}

async function enable(c: ReqCtx): Promise<Response> {
  const uid = acct(c);
  const id = pluginParam(c);
  if (!c.core.kernel.get(id)) return fail(403, `插件 ${id} 还没被管理员放行`, CODE_NOT_ALLOWED);
  if (c.core.kernel.setEnabled(uid, id, true)) pushPlugin(c.core, id, "enabled", { uid, version: c.core.kernel.get(id)!.meta.version });
  return json(view(c, uid));
}

// 停用; ?purge=1 同时清掉这个账号在该插件下的全部数据。主人停用时一并拆掉 Agent 与工作台
async function disable(c: ReqCtx): Promise<Response> {
  const uid = acct(c);
  const id = pluginParam(c);
  const changed = c.core.kernel.setEnabled(uid, id, false);
  if (uid === c.core.users.ownerId()) await teardown(c.core, id);
  const purged = c.url.searchParams.get(QUERY_PURGE) === "1" ? c.core.pdata.purge(uid, id) : 0;
  if (changed) pushPlugin(c.core, id, "disabled", { uid });
  return json({ ...view(c, uid), purged });
}

async function choose(c: ReqCtx): Promise<Response> {
  const uid = acct(c);
  const point = param(c, 0);
  const body = (await readJson(c.req)) as { plugin?: unknown } | undefined;
  const plugin = typeof body?.plugin === "string" ? body.plugin : null;
  const err = c.core.kernel.choose(uid, point, plugin);
  if (err) return fail(400, err);
  return json(view(c, uid));
}

export const ALLOW_ROUTES: Route[] = [
  route(GET, PATH_PLUGIN_ALLOW_LIST, ROOM, getAllow),
  route(PUT, PATH_PLUGIN_ALLOW, ROOM, putAllow),
  route(DELETE, PATH_PLUGIN_ALLOW, ROOM, deleteAllow),
  route(PUT, PATH_PLUGIN_ENABLED, ROOM, enable),
  route(DELETE, PATH_PLUGIN_ENABLED, ROOM, disable),
  route(PUT, PATH_PLUGIN_CHOICE, ROOM, choose),
];

