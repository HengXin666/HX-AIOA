import {
  API_MESSAGES_PATH,
  API_SEND_PATH,
  HEALTH_PATH,
  QUERY_LIMIT,
  QUERY_SINCE,
  WS_PATH,
  isBody,
  type SendRequest,
} from "@hx-aioa/protocol";
import { isAuthorized } from "./auth";
import {
  ERR_BAD_BODY,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  HUB_NAME,
  SRC_API_DEFAULT,
} from "./constants";
import type { Env } from "./env";
import { clampInt, fail, json, preflight } from "./http";

export { Hub } from "./hub";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return preflight();
    if (url.pathname === HEALTH_PATH) return json({ ok: true });
    if (!isAuthorized(req, url, env.AUTH_TOKEN)) return fail(401, ERR_UNAUTHORIZED);

    const hub = env.HUB.get(env.HUB.idFromName(HUB_NAME));

    if (url.pathname === WS_PATH) return hub.fetch(req);

    if (url.pathname === API_SEND_PATH && req.method === "POST") {
      const payload = (await req.json().catch(() => null)) as SendRequest | null;
      if (!payload || !isBody(payload.body)) return fail(400, ERR_BAD_BODY);
      try {
        return json(await hub.post(payload.src || SRC_API_DEFAULT, payload.body));
      } catch (e) {
        return fail(400, String(e));
      }
    }

    if (url.pathname === API_MESSAGES_PATH && req.method === "GET") {
      const since = clampInt(url.searchParams.get(QUERY_SINCE), 0, Number.MAX_SAFE_INTEGER);
      const limit = clampInt(url.searchParams.get(QUERY_LIMIT), HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
      return json(await hub.history(since, limit));
    }

    return fail(404, ERR_NOT_FOUND);
  },
} satisfies ExportedHandler<Env>;
