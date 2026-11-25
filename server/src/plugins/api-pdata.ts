import {
  MAX_PDATA_BATCH,
  PATH_PDATA_COLL,
  PATH_PDATA_ITEM,
  PDATA_ID_RE,
  PERM_DATA_OWN,
  PERM_READ_PREFIX,
  TODO_PLUGIN,
  checkTodoBody,
  globMatch,
  type Contribution,
  type PDataBatch,
  type PDataBatchResult,
  type PDataPut,
  type TodoBody,
} from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_CONFLICT, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, GET, POST, PUT } from "../constants";
import { ROOM, type ReqCtx, type Route, route } from "../core";
import { ApiFail, fail, json, readJson } from "../http";
import { legacyTodoSync } from "./api-todos";
import { pushPData } from "./notify";
import { checkBody } from "./pdata";
import { normTodo } from "./todos";
import { acctOf, pluginOfKey } from "./who";

// scope: 插件 Agent 的 key 只能碰自己白名单里的群的待办 (主人账号下各群共用一个集合); null 表示不限
type Target = { acct: string; plugin: string; coll: Contribution; scope: string[] | null };

function param(c: ReqCtx, i: number): string {
  try {
    return decodeURIComponent(c.params[i] ?? "");
  } catch {
    throw new ApiFail(400, CODE_BAD_REQUEST, "路径参数编码不合法");
  }
}
const deny = (text = ERR_FORBIDDEN) => new ApiFail(403, CODE_FORBIDDEN, text);
const ID_ERR = "id 只能包含字母数字和 _ . : -, 最多 64 字";

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
  const keyed = !(c.who.owner || c.who.member);
  return { acct, plugin, coll, scope: keyed && plugin === TODO_PLUGIN && !c.who.owner ? c.who.key.channels : null };
}

function itemId(c: ReqCtx): string {
  const id = param(c, 2);
  if (!PDATA_ID_RE.test(id)) throw new ApiFail(400, CODE_BAD_REQUEST, ID_ERR);
  return id;
}

// 集合声明之外, 待办插件再校验取值, 旧接口读出来的才是合法的 TodoItem
function bodyError(t: Target, id: string, body: unknown): string | null {
  return checkBody(t.coll, body) ?? (t.plugin === TODO_PLUGIN ? checkTodoBody(id, body) : null);
}

// 主人账号的待办经 pdata 改了, 旧客户端也要刷新; channels 是改动涉及的群
function touched(c: ReqCtx, t: Target, rev: number, channels: (string | undefined)[]): void {
  if (!rev) return;
  pushPData(c.core, t.acct, t.plugin, t.coll.id, rev);
  if (t.plugin !== TODO_PLUGIN || t.acct !== c.core.users.ownerId()) return;
  for (const ch of new Set(channels)) if (ch) legacyTodoSync(c.core, ch);
}
// 写之前: 新内容 (有的话) 与库里现有的行都要在范围内, 免得把别的群的待办改到本群或反过来
function scoped(c: ReqCtx, t: Target, id: string, next?: unknown): boolean {
  if (!t.scope) return true;
  if (next !== undefined && !inScope(t, next)) return false;
  const prev = c.core.pdata.get(t.acct, t.plugin, t.coll.id, id);
  return !prev || !!prev.deleted || inScope(t, prev.body);
}

// 待办的 doneAt 与 gh 由服务端维护 (见 normTodo), 其他插件原样写
function fixBody(c: ReqCtx, t: Target, id: string, body: unknown): unknown {
  if (t.plugin !== TODO_PLUGIN) return body;
  const prev = c.core.pdata.get(t.acct, t.plugin, t.coll.id, id);
  return normTodo(prev && !prev.deleted ? (prev.body as TodoBody) : null, body as TodoBody);
}
// 行所在的群是否在 key 的白名单里; 不是待办或不限范围时恒为真
const inScope = (t: Target, body: unknown): boolean => !t.scope || (t.scope as string[]).some((p) => globMatch(p, channelOf(body) ?? ""));
const outOfScope = () => new ApiFail(403, CODE_FORBIDDEN, "只能读写本群的待办");
const channelOf = (body: unknown) => (body as Partial<TodoBody> | null | undefined)?.channel;

function list(c: ReqCtx): Response {
  const t = target(c, false);
  const since = Math.max(0, Number(c.url.searchParams.get("since") ?? 0) || 0);
  const limit = Number(c.url.searchParams.get("limit") ?? 0) || undefined;
  const page = c.core.pdata.list(t.acct, t.plugin, t.coll.id, since, limit);
  // 墓碑没有 body, 照常给 (只透露 id); 其余按群过滤, rev 与 more 不变
  return json(t.scope ? { ...page, items: page.items.filter((i) => i.deleted || inScope(t, i.body)) } : page);
}

function getOne(c: ReqCtx): Response {
  const t = target(c, false);
  const item = c.core.pdata.get(t.acct, t.plugin, t.coll.id, itemId(c));
  return item && (item.deleted || inScope(t, item.body)) ? json({ item }) : fail(404, "没有这一行", CODE_NOT_FOUND);
}

async function put(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as Partial<PDataPut> | undefined;
  const t = target(c, true);
  const id = itemId(c);
  if (!body || !Number.isInteger(body.ver) || (body.ver as number) < 0) return fail(400, "需要 { \"ver\": 读到的版本 (新建为 0), \"body\": {...} }");
  const err = bodyError(t, id, body.body);
  if (err) return fail(400, err);
  if (!scoped(c, t, id, body.body)) throw outOfScope();
  const r = c.core.pdata.put(t.acct, t.plugin, t.coll.id, id, body.ver as number, fixBody(c, t, id, body.body));
  if ("error" in r) return fail(400, r.error);
  if ("conflict" in r) return fail(409, "版本不对, 先重新读再改", CODE_CONFLICT, { current: r.conflict });
  // 内容没变时 ver 不动, 不推送
  if (r.ok.ver === (body.ver as number) + 1) touched(c, t, r.ok.rev, [channelOf(body.body)]);
  return json({ item: r.ok });
}

function remove(c: ReqCtx): Response {
  const t = target(c, true);
  const ver = Number(c.url.searchParams.get("ver"));
  if (!Number.isInteger(ver) || ver < 1) return fail(400, "删除需要 ?ver=读到的版本");
  const id = itemId(c);
  if (!scoped(c, t, id)) throw outOfScope();
  const was = channelOf(c.core.pdata.get(t.acct, t.plugin, t.coll.id, id)?.body);
  const r = c.core.pdata.remove(t.acct, t.plugin, t.coll.id, id, ver);
  if ("conflict" in r) return fail(409, "版本不对, 先重新读再删", CODE_CONFLICT, { current: r.conflict });
  if ("ok" in r && r.ok.ver === ver + 1) touched(c, t, r.ok.rev, [was]);
  return json({ item: "ok" in r ? r.ok : null });
}

// 批量写: 每行独立生效 (不是事务), 一次请求只推一次 pdata_sync
async function batch(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as Partial<PDataBatch> | undefined;
  const t = target(c, true);
  const rows = body?.items;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_PDATA_BATCH) return fail(400, `需要 { "items": [{ "id", "ver", "body" 或 "deleted": true }] }, 一次 1 到 ${MAX_PDATA_BATCH} 行`);
  const out: PDataBatchResult = { items: [], rev: 0 };
  const channels: (string | undefined)[] = [];
  for (const row of rows) {
    const id = typeof row?.id === "string" ? row.id : "";
    const ver = row?.ver as number;
    const err = !PDATA_ID_RE.test(id) ? ID_ERR : !Number.isInteger(ver) || ver < 0 ? "ver 必须是读到的版本 (新建为 0)" : (row.deleted === true ? null : bodyError(t, id, row.body)) ?? (scoped(c, t, id, row.deleted === true ? undefined : row.body) ? null : "只能读写本群的待办");
    if (err) {
      out.items.push({ id, error: err });
      continue;
    }
    if (row.deleted === true) channels.push(channelOf(c.core.pdata.get(t.acct, t.plugin, t.coll.id, id)?.body));
    const r = row.deleted === true ? c.core.pdata.remove(t.acct, t.plugin, t.coll.id, id, ver) : c.core.pdata.put(t.acct, t.plugin, t.coll.id, id, ver, fixBody(c, t, id, row.body));
    if ("error" in r) out.items.push({ id, error: r.error });
    else if ("conflict" in r) out.items.push({ id, conflict: r.conflict });
    else {
      out.items.push({ id, item: r.ok });
      if (r.ok.ver !== ver + 1) continue;
      out.rev = Math.max(out.rev, r.ok.rev);
      if (row.deleted !== true) channels.push(channelOf(row.body));
    }
  }
  touched(c, t, out.rev, channels);
  return json(out);
}

export const PDATA_ROUTES: Route[] = [
  route(GET, PATH_PDATA_COLL, ROOM, list),
  route(POST, PATH_PDATA_COLL, ROOM, batch),
  route(GET, PATH_PDATA_ITEM, ROOM, getOne),
  route(PUT, PATH_PDATA_ITEM, ROOM, put),
  route(DELETE, PATH_PDATA_ITEM, ROOM, remove),
];
