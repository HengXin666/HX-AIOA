import {
  MAX_PLUGIN_TEXT,
  PATH_PLUGIN_DEV,
  PATH_PLUGIN_DEV_MODE,
  isL2a,
  isPluginId,
  parseManifest,
  type PluginDevInput,
} from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_CONFLICT, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_NO_RESOURCE, GET, PUT } from "../constants";
import { type Core, ROOM, type ReqCtx, type Route, route } from "../core";
import { ApiFail, fail, json, pathParam, readJson } from "../http";
import { teardown } from "./api";
import { pushPlugin } from "./notify";
import { autoUpgrade } from "./update";
import { acctOf, isAdmin } from "./who";

const CODE_DEV_OFF = "plugin_dev_off";

// 开发模式只给管理员自己的账号 (主人或 admin 子号), 插件 Agent 的 key 不行
function dev(c: ReqCtx): string {
  const uid = acctOf(c.core, c.who);
  if (!uid || !(c.who.owner || c.who.member) || !isAdmin(c.who)) throw new ApiFail(403, CODE_FORBIDDEN, "只有管理员能用开发模式");
  return uid;
}

const mine = (core: Core, uid: string) => core.kernel.list().filter((a) => a.dev && a.by === uid);

function view(c: ReqCtx, uid: string): Response {
  return json({ on: c.core.kernel.devMode(uid), plugins: mine(c.core, uid) });
}

/** 撤掉一个开发插件: 白名单, 启用, 主人装的 Agent 与工作台一起; pdata 保留, 同 id 再装能接上。 */
async function drop(core: Core, uid: string, id: string): Promise<void> {
  core.kernel.revoke(id);
  await teardown(core, id);
  pushPlugin(core, id, "revoked", { uid });
}

async function setMode(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as { on?: unknown } | undefined;
  const uid = dev(c);
  if (typeof body?.on !== "boolean") return fail(400, "需要 { \"on\": true | false }");
  if (!body.on) for (const a of mine(c.core, uid)) await drop(c.core, uid, a.id);
  c.core.kernel.setDevMode(uid, body.on);
  return view(c, uid);
}

const text = (v: unknown, name: string): string => {
  if (v === undefined) return "";
  if (typeof v !== "string" || v.length > MAX_PLUGIN_TEXT) throw new ApiFail(400, CODE_BAD_REQUEST, `${name} 是不超过 ${MAX_PLUGIN_TEXT} 字的文本`);
  return v;
};

// 装上或换掉一个本地插件: 只允许 L0 / L1 / L3, 不能带服务端代码, 不能占用市场已放行的 id
async function put(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as PluginDevInput | undefined;
  const uid = dev(c);
  if (!c.core.kernel.devMode(uid)) return fail(403, "先打开开发模式", CODE_DEV_OFF);
  const id = pathParam(c.params, 0);
  const m = parseManifest(body?.manifest);
  if (typeof m === "string") return fail(400, m);
  if (m.id !== id || !isPluginId(id)) return fail(400, "路径里的 id 与清单不一致");
  if (m.server || isL2a(id)) return fail(400, "开发模式不能装带服务端代码的插件");
  const prompt = text(body?.prompt, "prompt");
  const readme = text(body?.readme, "readme");
  const old = c.core.kernel.get(id)?.meta;
  if (old && !(old.dev && old.by === uid)) return fail(409, `${id} 已被放行或别人在开发, 换一个 id`, CODE_CONFLICT);
  const row = { meta: { id, version: m.version, name: m.name, by: uid, at: Date.now(), dev: true as const }, manifest: m, prompt, readme };
  const result = c.core.kernel.check(row);
  if (result.conflicts.length) return fail(409, `${id} 与白名单冲突`, "plugin_conflict", { conflicts: result.conflicts });
  c.core.kernel.put(row);
  c.core.kernel.setEnabled(uid, id, true);
  pushPlugin(c.core, id, old ? "updated" : "allowed", { uid, version: m.version });
  // 主人装过它的 Agent: 换上新提示词并推给 Agent 长连, 秒级生效 (L3 热更新)
  await autoUpgrade(c.core, id);
  return json({ allow: c.core.kernel.get(id)!.meta });
}

async function remove(c: ReqCtx): Promise<Response> {
  const uid = dev(c);
  const id = pathParam(c.params, 0);
  const row = c.core.kernel.get(id)?.meta;
  if (!row?.dev || row.by !== uid) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  await drop(c.core, uid, id);
  return json({ ok: true });
}

export const DEV_ROUTES: Route[] = [
  route(GET, PATH_PLUGIN_DEV_MODE, ROOM, async (c) => view(c, dev(c))),
  route(PUT, PATH_PLUGIN_DEV_MODE, ROOM, setMode),
  route(PUT, PATH_PLUGIN_DEV, ROOM, put),
  route(DELETE, PATH_PLUGIN_DEV, ROOM, remove),
];
