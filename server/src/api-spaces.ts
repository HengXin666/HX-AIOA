import { PATH_SPACE, PATH_SPACE_DATA, PATH_SPACE_STATE, PATH_SPACES, demoteTab } from "@hx-aioa/protocol";
import { CODE_NOT_FOUND, DELETE, ERR_NO_RESOURCE, GET, POST, PUT, RECENT_SCAN } from "./constants";
import { OWNER, type ReqCtx, type Route, keyIdOf, route } from "./core";
import { fail, json, readJson } from "./http";
import { resolveSpaceData } from "./space-data";
import { clientOfUrl, pushSpace, spaceFor } from "./plugins/client";

const notFound = () => fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
const idParam = (c: ReqCtx) => decodeURIComponent(c.params[0] ?? "");

// 接受 Space 本体, 或 { space } 包一层 (to 字段待多账号落地)
async function putSpace(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as Record<string, unknown> | undefined;
  const raw = body && typeof body === "object" && "space" in body ? body.space : body;
  const origin = c.who.owner ? "manual" : `key:${keyIdOf(c.who)}`;
  // Agent 下发的空间不能抢顶部标签 (tab: "primary" 降为 auto, #139); 主人手动的照收
  const r = await c.core.spaces.put(c.who.owner ? raw : demoteTab(raw), origin);
  if ("errors" in r) return fail(400, "布局校验失败", undefined, { errors: r.errors });
  pushSpace(c.core, r.space);
  return json({ ok: true, delivered: 1 });
}

export const SPACE_ROUTES: Route[] = [
  route(GET, PATH_SPACES, OWNER, async (c) => json({ spaces: (await c.core.spaces.list()).map((s) => spaceFor(c.core, s, clientOfUrl(c.url))).filter((s) => s !== null) })),
  route(POST, PATH_SPACES, "spaces:write", putSpace),
  route(DELETE, PATH_SPACE, OWNER, async (c) => {
    const id = idParam(c);
    if (!(await c.core.spaces.remove(id))) return notFound();
    c.core.sockets.toV1Clients({ t: "space_update", id, deleted: true });
    return json({ ok: true });
  }),
  route(PUT, PATH_SPACE_STATE, OWNER, async (c) => {
    const r = await c.core.spaces.setState(idParam(c), await readJson(c.req));
    if (r === null) return notFound();
    if (typeof r === "string") return fail(400, r);
    // 其他设备同步排序与尺寸
    pushSpace(c.core, r);
    return json({ space: r });
  }),
  route(GET, PATH_SPACE_DATA, OWNER, async (c) => {
    const space = await c.core.spaces.get(idParam(c));
    if (!space) return notFound();
    return json(resolveSpaceData(space, c.core.metrics, c.core.store.recent(RECENT_SCAN)));
  }),
];
