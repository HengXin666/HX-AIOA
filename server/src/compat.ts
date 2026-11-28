import { PATH_COMPAT, PROTOCOL_VERSION, QUERY_CLIENT, QUERY_CLIENT_BUILD, QUERY_PROTOCOL, STATUS_BLOCKED, compatOf, parseClient, parseProtocol, type Compat } from "@hx-aioa/protocol";
import { GET } from "./constants";
import { ROOM, type Route, route } from "./core";
import { fail, json } from "./http";

const CODE_BLOCKED = "client_blocked";

/** 客户端在地址上带了 pv 才给档位; 老客户端不带, 照旧。带了 client / cb (#156) 就把认下的端与构建号一起回给客户端。 */
export function compatFor(url: URL): Compat | undefined {
  const pv = parseProtocol(url.searchParams.get(QUERY_PROTOCOL));
  const client = parseClient(url.searchParams.get(QUERY_CLIENT), url.searchParams.get(QUERY_CLIENT_BUILD));
  if (pv === undefined && !client) return undefined;
  return { ...compatOf(pv, PROTOCOL_VERSION), ...(client ? { client } : {}) };
}

/** 只有安全漏洞才拒绝: 有 pv 且在封禁名单里时返回 426。 */
export function blocked(url: URL): Response | null {
  const c = compatFor(url);
  return c?.level === "blocked" ? fail(STATUS_BLOCKED, c.msg ?? "", CODE_BLOCKED, { compat: c }) : null;
}

export const COMPAT_ROUTES: Route[] = [
  route(GET, PATH_COMPAT, ROOM, async (c) => blocked(c.url) ?? json(compatFor(c.url) ?? compatOf(undefined, PROTOCOL_VERSION))),
];
