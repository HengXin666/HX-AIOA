import {
  EXT_ACCESS,
  EXT_MAX_HOURS,
  EXT_TTL_HOURS,
  PATH_EXT_MCP,
  PATH_EXT_MD,
  PATH_TODO_EXT,
  PATH_TODO_EXT_ONE,
  PLUGIN_CHANNEL_PREFIX,
  type ExtAccess,
  type ExtKeyCreated,
  type ExtKeyInfo,
  type KeyInfo,
} from "@hx-aioa/protocol";
import { baseOf } from "../api-chats";
import { CODE_FORBIDDEN, DELETE, ERR_FORBIDDEN, GET, POST } from "../constants";
import { OWNER, type Principal, type ReqCtx, ROOM, type Route, route } from "../core";
import { fail, json, readJson } from "../http";
import { mcp } from "./mcp";
import { todosMarkdown } from "./todo-md";

const HOUR = 3_600_000;
const EXT_RATE = 60;
// 不带 channel 时默认点子待办群
export const DEFAULT_TODO_CHANNEL = `${PLUGIN_CHANNEL_PREFIX}todo`;

const p = (c: ReqCtx, i: number) => decodeURIComponent(c.params[i] ?? "");
const infoOf = (k: KeyInfo): ExtKeyInfo => ({ id: k.id, name: k.name, access: k.ext!, prefix: k.prefix, created: k.created, ...(k.expires ? { expires: k.expires } : {}), ...(k.used ? { used: k.used } : {}) });

/** 外部接入能碰的群: ext key 只有自己那个群; 主人用 ?channel= 指定。 */
export function extChannel(c: ReqCtx): string | null {
  if (c.who.owner) return c.url.searchParams.get("channel") || DEFAULT_TODO_CHANNEL;
  return !c.who.member && c.who.key.ext ? (c.who.key.channels[0] ?? null) : null;
}

export const extWritable = (who: Principal) => who.owner || (!who.member && who.key.ext === "write");

function list(c: ReqCtx): Response {
  const channel = p(c, 0);
  const now = Date.now();
  const keys = c.core.registry.keys().filter((k) => k.ext && k.channels[0] === channel && !(k.expires && k.expires < now));
  return json({ keys: keys.map(infoOf) });
}

async function create(c: ReqCtx): Promise<Response> {
  const channel = p(c, 0);
  const b = (await readJson(c.req)) as { name?: unknown; access?: unknown; hours?: unknown } | undefined;
  const name = typeof b?.name === "string" && b.name.trim() ? b.name.trim().slice(0, 40) : "外部接入";
  const access: ExtAccess = (EXT_ACCESS as readonly unknown[]).includes(b?.access) ? (b!.access as ExtAccess) : "read";
  const hours = b?.hours === undefined ? EXT_TTL_HOURS : Number(b.hours);
  if (!Number.isInteger(hours) || hours < 0 || hours > EXT_MAX_HOURS) return fail(400, `hours 为 0 (不过期) 到 ${EXT_MAX_HOURS}`);
  const { info, key } = await c.core.registry.createKey({ name, scopes: [], channels: [channel], ratePerMin: EXT_RATE });
  info.ext = access;
  if (hours) info.expires = Date.now() + hours * HOUR;
  c.core.registry.saveKey(info);
  const base = baseOf(c.url);
  const body: ExtKeyCreated = { info: infoOf(info), key, mcp: `${base}${PATH_EXT_MCP}`, md: `${base}${PATH_EXT_MD}?key=${key}` };
  return json(body);
}

function remove(c: ReqCtx): Response {
  const k = c.core.registry.key(p(c, 1));
  if (!k?.ext || k.channels[0] !== p(c, 0)) return fail(404, "没有这把接入密钥", "not_found");
  c.core.registry.deleteKey(k.id);
  return json({ ok: true });
}

function md(c: ReqCtx): Response {
  const channel = extChannel(c);
  if (!channel) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const all = c.url.searchParams.get("all") === "1";
  const text = todosMarkdown(c.core.chats.chat(channel)?.title || channel, c.core.todos.list(channel), { all });
  return new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" } });
}

export const EXT_ROUTES: Route[] = [
  route(GET, PATH_TODO_EXT, OWNER, list),
  route(POST, PATH_TODO_EXT, OWNER, create),
  route(DELETE, PATH_TODO_EXT_ONE, OWNER, remove),
  route(GET, PATH_EXT_MD, ROOM, md),
  route(POST, PATH_EXT_MCP, ROOM, mcp),
];
