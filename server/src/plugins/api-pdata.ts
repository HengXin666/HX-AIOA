import { PATH_PDATA_COLL, PATH_PDATA_ITEM, PDATA_ID_RE, PERM_DATA_OWN, PERM_READ_PREFIX, type Contribution, type PDataPut } from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_CONFLICT, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, GET, PUT } from "../constants";
import { ROOM, type ReqCtx, type Route, route } from "../core";
import { ApiFail, fail, json, readJson } from "../http";
import { pushPData } from "./notify";
import { checkBody } from "./pdata";
import { acctOf, pluginOfKey } from "./who";

type Target = { acct: string; plugin: string; coll: Contribution };

function param(c: ReqCtx, i: number): string {
  try {
    return decodeURIComponent(c.params[i] ?? "");
  } catch {
    throw new ApiFail(400, CODE_BAD_REQUEST, "路径参数编码不合法");
  }
}
const deny = (text = ERR_FORBIDDEN) => new ApiFail(403, CODE_FORBIDDEN, text);

/**
 * 谁能碰 (账号, 插件, 集合): 主人与子号能读写自己账号下启用了的插件;
 * 插件 Agent 能读写本插件的集合, 读别的插件要清单里有 data:read:<插件>.<集合>。
 */
function target(c: ReqCtx, write: boolean): Target {
  const acct = acctOf(c.core, c.who);
  if (!acct) throw deny();
  const plugin = param(c, 0);
  const name = param(c, 1);
  const k = c.core.kernel;
  const row = k.get(plugin);
  if (!row || !k.isEnabled(acct, plugin)) throw new ApiFail(404, CODE_NOT_FOUND, `插件 ${plugin} 没有启用`);
  if (!(row.manifest.permissions ?? []).includes(PERM_DATA_OWN)) throw deny(`插件 ${plugin} 没有申请 ${PERM_DATA_OWN}`);
  const coll = (row.manifest.contributes?.collections ?? []).find((x) => x.id === name);
  if (!coll) throw new ApiFail(404, CODE_NOT_FOUND, `插件 ${plugin} 没有声明集合 ${name}`);
  const caller = pluginOfKey(c.core, c.who);
  if (caller && caller !== plugin) {
    const perms = k.get(caller)?.manifest.permissions ?? [];
    if (write || !perms.includes(`${PERM_READ_PREFIX}${plugin}.${name}`)) throw deny(`插件 ${caller} 不能${write ? "写" : "读"} ${plugin}.${name}`);
  }
  return { acct, plugin, coll };
}

function itemId(c: ReqCtx): string {
  const id = param(c, 2);
  if (!PDATA_ID_RE.test(id)) throw new ApiFail(400, CODE_BAD_REQUEST, "id 只能包含字母数字和 _ . : -, 最多 64 字");
  return id;
}

function list(c: ReqCtx): Response {
  const t = target(c, false);
  const since = Math.max(0, Number(c.url.searchParams.get("since") ?? 0) || 0);
  const limit = Number(c.url.searchParams.get("limit") ?? 0) || undefined;
  return json(c.core.pdata.list(t.acct, t.plugin, t.coll.id, since, limit));
}

function getOne(c: ReqCtx): Response {
  const t = target(c, false);
  const item = c.core.pdata.get(t.acct, t.plugin, t.coll.id, itemId(c));
  return item ? json({ item }) : fail(404, "没有这一行", CODE_NOT_FOUND);
}

async function put(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as Partial<PDataPut> | undefined;
  const t = target(c, true);
  const id = itemId(c);
  if (!body || !Number.isInteger(body.ver) || (body.ver as number) < 0) return fail(400, "需要 { \"ver\": 读到的版本 (新建为 0), \"body\": {...} }");
  const err = checkBody(t.coll, body.body);
  if (err) return fail(400, err);
  const r = c.core.pdata.put(t.acct, t.plugin, t.coll.id, id, body.ver as number, body.body);
  if ("error" in r) return fail(400, r.error);
  if ("conflict" in r) return fail(409, "版本不对, 先重新读再改", CODE_CONFLICT, { current: r.conflict });
  pushPData(c.core, t.acct, t.plugin, t.coll.id, r.ok.rev);
  return json({ item: r.ok });
}

function remove(c: ReqCtx): Response {
  const t = target(c, true);
  const ver = Number(c.url.searchParams.get("ver"));
  if (!Number.isInteger(ver) || ver < 1) return fail(400, "删除需要 ?ver=读到的版本");
  const r = c.core.pdata.remove(t.acct, t.plugin, t.coll.id, itemId(c), ver);
  if ("conflict" in r) return fail(409, "版本不对, 先重新读再删", CODE_CONFLICT, { current: r.conflict });
  if ("ok" in r) pushPData(c.core, t.acct, t.plugin, t.coll.id, r.ok.rev);
  return json({ item: "ok" in r ? r.ok : null });
}

export const PDATA_ROUTES: Route[] = [
  route(GET, PATH_PDATA_COLL, ROOM, list),
  route(GET, PATH_PDATA_ITEM, ROOM, getOne),
  route(PUT, PATH_PDATA_ITEM, ROOM, put),
  route(DELETE, PATH_PDATA_ITEM, ROOM, remove),
];
