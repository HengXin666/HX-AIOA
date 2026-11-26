import {
  HXOA_PLUGIN,
  PATH_HXOA,
  PATH_HXOA_BROWSE,
  PATH_HXOA_MKDIR,
  PATH_HXOA_ONE,
  PATH_HXOA_STATE,
  PATH_HXOA_TOKEN,
  PATH_HXOA_TOKEN_MERGE,
  PATH_HXOA_TOKEN_PROMPT,
  PATH_HXOA_WS,
  PATH_HXOA_WS_ONE,
  PATH_HXOA_WS_TOKENS,
  isHxoaId,
  parseHxoaConn,
  parseHxoaLabel,
  parseHxoaMkdir,
  parseHxoaWs,
  parseHxoaWsPatch,
} from "@hx-aioa/protocol";
import { DELETE, GET, PATCH, POST } from "../constants";
import { type Core, type Handler, OWNER, type ReqCtx, type Route, route } from "../core";
import { githubOff } from "../github/gate";
import { fail, json, readJson } from "../http";

/** 只看主人的启用状态 (内核内存); 没启用时整组接口当作不存在。 */
export const hxoaOn = (core: Core): boolean => core.kernel.isEnabled(core.users.ownerId(), HXOA_PLUGIN);
const gated = (h: Handler): Handler => (c) => (hxoaOn(c.core) ? h(c) : githubOff(c.req));
// 只有主人能用: 管理令牌等于那台机器的远程控制权, 不开放给 Agent 的 key
const r = (method: string, path: string, h: Handler) => route(method, path, OWNER, gated(h));
const arg = (c: ReqCtx, i: number) => decodeURIComponent(c.params[i] ?? "");
const idOf = (c: ReqCtx) => arg(c, 0);
const OK = { ok: true };
const BAD_ID = "id 不对";

/** 工作区 / 令牌 id 要拼进 hxoa 的路径, 先校验。 */
const sub = (h: (c: ReqCtx, sid: string) => Promise<Response>): Handler => (c) => {
  const sid = arg(c, 1);
  return isHxoaId(sid) ? h(c, sid) : fail(400, BAD_ID);
};

export const HXOA_ROUTES: Route[] = [
  r(GET, PATH_HXOA, async (c) => json({ conns: await c.core.hxoa.list() })),
  r(POST, PATH_HXOA, async (c) => {
    const input = parseHxoaConn(await readJson(c.req));
    if (typeof input === "string") return fail(400, input);
    return json(await c.core.hxoa.add(input));
  }),
  r(PATCH, PATH_HXOA_ONE, async (c) => {
    const b = (await readJson(c.req)) as { name?: unknown } | undefined;
    const name = typeof b?.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 40) return fail(400, "name 为 1 到 40 字");
    c.core.hxoa.rename(idOf(c), name);
    return json(OK);
  }),
  r(DELETE, PATH_HXOA_ONE, async (c) => json({ ok: c.core.hxoa.remove(idOf(c)) })),
  r(GET, PATH_HXOA_STATE, async (c) => json(await c.core.hxoa.state(idOf(c)))),
  r(GET, PATH_HXOA_BROWSE, async (c) => json(await c.core.hxoa.browse(idOf(c), c.url.searchParams.get("path") ?? ""))),
  r(POST, PATH_HXOA_MKDIR, async (c) => {
    const input = parseHxoaMkdir(await readJson(c.req));
    if (typeof input === "string") return fail(400, input);
    return json(await c.core.hxoa.mkdir(idOf(c), input.parent, input.name));
  }),
  r(POST, PATH_HXOA_WS, async (c) => {
    const input = parseHxoaWs(await readJson(c.req));
    if (typeof input === "string") return fail(400, input);
    return json(await c.core.hxoa.addWorkspace(idOf(c), input));
  }),
  r(
    PATCH,
    PATH_HXOA_WS_ONE,
    sub(async (c, ws) => {
      const patch = parseHxoaWsPatch(await readJson(c.req));
      if (typeof patch === "string") return fail(400, patch);
      await c.core.hxoa.patchWorkspace(idOf(c), ws, patch);
      return json(OK);
    }),
  ),
  r(
    DELETE,
    PATH_HXOA_WS_ONE,
    sub(async (c, ws) => {
      await c.core.hxoa.deleteWorkspace(idOf(c), ws);
      return json(OK);
    }),
  ),
  r(
    POST,
    PATH_HXOA_WS_TOKENS,
    sub(async (c, ws) => {
      const label = parseHxoaLabel(await readJson(c.req));
      if (!label) return fail(400, "身份名只能用字母数字 . _ -, 最长 32");
      return json(await c.core.hxoa.addToken(idOf(c), ws, label));
    }),
  ),
  r(GET, PATH_HXOA_TOKEN_PROMPT, sub(async (c, tok) => json(await c.core.hxoa.prompt(idOf(c), tok)))),
  r(POST, PATH_HXOA_TOKEN_MERGE, sub(async (c, tok) => json(await c.core.hxoa.merge(idOf(c), tok)))),
  r(
    DELETE,
    PATH_HXOA_TOKEN,
    sub(async (c, tok) => {
      await c.core.hxoa.deleteToken(idOf(c), tok);
      return json(OK);
    }),
  ),
];
