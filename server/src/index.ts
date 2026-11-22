import { HEALTH_PATH, PROTOCOL_VERSION } from "@hx-aioa/protocol";
import { HUB_NAME } from "./constants";
import type { Env } from "./env";
import { json, preflight } from "./http";

export { Hub } from "./hub";

// Worker 只做 CORS 预检与健康检查, 鉴权与路由都在 Hub 内, 便于多账号时按用户分派
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return preflight();
    const url = new URL(req.url);
    if (url.pathname === HEALTH_PATH) return json({ ok: true, v: PROTOCOL_VERSION });
    return env.HUB.get(env.HUB.idFromName(HUB_NAME)).fetch(req);
  },
} satisfies ExportedHandler<Env>;
