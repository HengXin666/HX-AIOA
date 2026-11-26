import { PATH_PLUGIN_SOURCE, PATH_PLUGIN_SOURCES, PATH_PLUGIN_SOURCES_REFRESH, type MarketSourceList } from "@hx-aioa/protocol";
import { CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, ERR_NO_RESOURCE, GET, POST } from "../constants";
import { ROOM, type ReqCtx, type Route, route } from "../core";
import { fail, json, pathParam, readJson } from "../http";
import { isAdmin } from "./who";

// 市场源是整个部署的: 只有管理员能看能改, 加进来的插件照样要管理员逐个放行
async function list(c: ReqCtx): Promise<Response> {
  if (!isAdmin(c.who)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  // 走缓存加载一遍, DO 唤醒后也能显示各源状态 (没过期不发请求)
  await c.core.market.index().catch(() => []);
  return json({ sources: c.core.market.sources() } satisfies MarketSourceList);
}

async function add(c: ReqCtx): Promise<Response> {
  if (!isAdmin(c.who)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const body = (await readJson(c.req)) as { link?: unknown } | null;
  if (typeof body?.link !== "string") return fail(400, "需要 link");
  return json(await c.core.market.addSource(body.link, c.who.owner), 201);
}

function remove(c: ReqCtx): Response {
  if (!isAdmin(c.who)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const id = pathParam(c.params, 0);
  if (c.core.market.isPrivate(id) && !c.who.owner) return fail(403, "私有源只有主人能移除", CODE_FORBIDDEN);
  return c.core.market.removeSource(id) ? json({ ok: true }) : fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
}

/** 手动刷新: 各源强制重拉索引 (出错的源也立刻重试), 清掉文件缓存。 */
async function refresh(c: ReqCtx): Promise<Response> {
  if (!isAdmin(c.who)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  await c.core.market.refresh();
  return json({ sources: c.core.market.sources() } satisfies MarketSourceList);
}

export const SOURCE_ROUTES: Route[] = [
  route(GET, PATH_PLUGIN_SOURCES, ROOM, list),
  route(POST, PATH_PLUGIN_SOURCES, ROOM, add),
  route(DELETE, PATH_PLUGIN_SOURCE, ROOM, remove),
  route(POST, PATH_PLUGIN_SOURCES_REFRESH, ROOM, refresh),
];
