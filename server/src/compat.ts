import { PATH_COMPAT, PROTOCOL_VERSION, QUERY_PROTOCOL, STATUS_BLOCKED, compatOf, parseProtocol, type Compat } from "@hx-aioa/protocol";
import { GET } from "./constants";
import { ROOM, type Route, route } from "./core";
import { fail, json } from "./http";

const CODE_BLOCKED = "client_blocked";

/** 客户端在地址上带了 pv 才给档位; 老客户端不带, 照旧。 */
export function compatFor(url: URL): Compat | undefined {
  const pv = parseProtocol(url.searchParams.get(QUERY_PROTOCOL));
  return pv === undefined ? undefined : compatOf(pv, PROTOCOL_VERSION);
}

/** 只有安全漏洞才拒绝: 有 pv 且在封禁名单里时返回 426。 */
export function blocked(url: URL): Response | null {
  const c = compatFor(url);
  return c?.level === "blocked" ? fail(STATUS_BLOCKED, c.msg ?? "", CODE_BLOCKED, { compat: c }) : null;
}

export const COMPAT_ROUTES: Route[] = [
  route(GET, PATH_COMPAT, ROOM, async (c) => blocked(c.url) ?? json(compatFor(c.url) ?? compatOf(undefined, PROTOCOL_VERSION))),
];
