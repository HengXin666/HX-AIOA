import { API_MESSAGES_PATH, API_SEND_PATH, API_V1, PATH_HOOKS, QUERY_LIMIT, QUERY_SINCE, isBody, type SendRequest } from "@hx-aioa/protocol";
import { AGENT_ROUTES } from "./api-agent";
import { CF_ROUTES } from "./api-cf";
import { CF_ZONE_ROUTES } from "./api-cf-zones";
import { CF_STORAGE_ROUTES } from "./api-cf-storage";
import { CHAT_ROUTES } from "./api-chats";
import { FEED_TAG_ROUTES } from "./api-feed-tags";
import { PRESENCE_ROUTES } from "./api-presence";
import { MEMORY_ROUTES } from "./api-agent-memory";
import { CHAT_DELETE_ROUTES } from "./api-chat-delete";
import { RECALL_ROUTES } from "./recall";
import { ROOM_ROUTES } from "./api-rooms";
import { FILE_ROUTES } from "./files/api";
import { PLUGIN_ROUTES } from "./plugins/api";
import { EXT_ROUTES } from "./plugins/ext";
import { GH_ROUTES } from "./gh/api";
import { HXOA_ROUTES } from "./hxoa/api";
import { ALLOW_ROUTES } from "./plugins/api-allow";
import { PDATA_ROUTES } from "./plugins/api-pdata";
import { MAIL_ROUTES } from "./mail/api";
import { MAIL_RULE_ROUTES } from "./mail/rules";
import { TRANSLATE_ROUTES } from "./translate/api";
import { CONFIG_ROUTES } from "./api-config";
import { INTEGRATION_ROUTES } from "./api-integrations";
import { PROBE_ROUTES } from "./api-probes";
import { RELAY_ROUTES } from "./api-relay";
import { GITHUB_ROUTES } from "./api-github";
import { SPACE_ROUTES } from "./api-spaces";
import { EVENT_ROUTES, messageInput, originOf, writeEvent } from "./api-events";
import { credentialOf, isOwnerToken } from "./auth";
import {
  CODE_FORBIDDEN,
  CODE_NOT_FOUND,
  CODE_RATE_LIMITED,
  CODE_UNAUTHORIZED,
  ERR_BAD_BODY,
  ERR_FORBIDDEN,
  ERR_NOT_FOUND,
  ERR_RATE,
  ERR_UNAUTHORIZED,
  GET,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  POST,
  SRC_API_DEFAULT,
} from "./constants";
import { type Core, type Principal, type Route, allowed } from "./core";
import { stampGuide } from "./agent-sync";
import { handleHook } from "./hooks";
import { ApiFail, clampInt, fail, json, readJson } from "./http";
import { toMsgFrame } from "./legacy";

const ROUTES: Route[] = [...EVENT_ROUTES, ...CONFIG_ROUTES, ...AGENT_ROUTES, ...SPACE_ROUTES, ...GITHUB_ROUTES, ...CHAT_ROUTES, ...FEED_TAG_ROUTES, ...PRESENCE_ROUTES, ...MEMORY_ROUTES, ...CHAT_DELETE_ROUTES, ...ROOM_ROUTES, ...FILE_ROUTES, ...PLUGIN_ROUTES, ...ALLOW_ROUTES, ...PDATA_ROUTES, ...EXT_ROUTES, ...GH_ROUTES, ...HXOA_ROUTES, ...MAIL_RULE_ROUTES, ...MAIL_ROUTES, ...TRANSLATE_ROUTES, ...RECALL_ROUTES, ...INTEGRATION_ROUTES, ...RELAY_ROUTES, ...PROBE_ROUTES, ...CF_ROUTES, ...CF_ZONE_ROUTES, ...CF_STORAGE_ROUTES];
const HOOK_RE = new RegExp(`^${PATH_HOOKS}/([^/]+)/([^/]+)$`);

export async function principalOf(core: Core, req: Request, url: URL): Promise<Principal | null> {
  const cred = credentialOf(req, url);
  if (isOwnerToken(cred, core.env.AUTH_TOKEN)) return { owner: true };
  const key = await core.registry.keyBySecret(cred);
  return key ? { owner: false, key } : null;
}

// 旧接口: /api/send 等价于 /api/v1/messages 直发给母号, /api/messages 返回旧 msg 帧
async function legacy(core: Core, req: Request, url: URL, who: Principal): Promise<Response | null> {
  if (url.pathname === API_SEND_PATH && req.method === POST) {
    if (!allowed(who, "messages:send")) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
    const payload = (await readJson(req)) as SendRequest | undefined;
    if (!payload || !isBody(payload.body)) return fail(400, ERR_BAD_BODY);
    const input = messageInput({ text: payload.body.text });
    if (typeof input === "string") return fail(400, input);
    const r = await writeEvent(core, who, input, originOf(core, who, payload.src || SRC_API_DEFAULT));
    const ev = core.store.get(r.id);
    return json({ seq: ev?.seq ?? 0, ts: ev?.ts ?? Date.now() });
  }
  if (url.pathname === API_MESSAGES_PATH && req.method === GET) {
    if (!who.owner) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
    const since = clampInt(url.searchParams.get(QUERY_SINCE), 0, Number.MAX_SAFE_INTEGER);
    const limit = clampInt(url.searchParams.get(QUERY_LIMIT), HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
    return json(core.store.since(since, limit).map(toMsgFrame));
  }
  return null;
}

// 没读请求体就提前返回时先丢弃它, 否则 workerd 会报 "请求流未读完" 并影响同一连接的下一个请求
async function early(req: Request, res: Response): Promise<Response> {
  if (req.body && !req.bodyUsed) await req.arrayBuffer().catch(() => undefined);
  return res;
}

export async function handleHttp(core: Core, req: Request, pre?: Principal): Promise<Response> {
  const url = new URL(req.url);
  try {
    const hook = HOOK_RE.exec(url.pathname);
    if (hook && req.method === POST) return await handleHook(core, req, url, hook[1] ?? "", hook[2] ?? "");
    const who = pre ?? (await principalOf(core, req, url));
    if (!who) return await early(req, fail(401, ERR_UNAUTHORIZED, CODE_UNAUTHORIZED));
    if (!who.owner && !core.registry.allow(who.key)) return await early(req, fail(429, ERR_RATE, CODE_RATE_LIMITED));
    if (!url.pathname.startsWith(API_V1)) return (await legacy(core, req, url, who)) ?? fail(404, ERR_NOT_FOUND, CODE_NOT_FOUND);
    for (const r of ROUTES) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      if (!allowed(who, r.need)) return await early(req, fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN));
      return await stampGuide(core, req, url, who, await r.handler({ req, url, params: m.slice(1), who, core }));
    }
    return fail(404, ERR_NOT_FOUND, CODE_NOT_FOUND);
  } catch (e) {
    if (e instanceof ApiFail) return fail(e.status, e.message, e.code);
    console.error("请求处理失败:", e);
    return fail(500, String(e), "internal");
  }
}
