import { HXOA_PLUGIN, PATH_HXOA, PATH_HXOA_EXEC, PATH_HXOA_LS, PATH_HXOA_MKDIR, PATH_HXOA_ONE, PATH_HXOA_READ, parseHxoaConn, parseHxoaExec, parseHxoaMkdir } from "@hx-aioa/protocol";
import { DELETE, GET, PATCH, POST } from "../constants";
import { type Core, type Handler, OWNER, type ReqCtx, type Route, route } from "../core";
import { githubOff } from "../github/gate";
import { fail, json, readJson } from "../http";

const MAX_DEPTH = 3;

/** 只看主人的启用状态 (内核内存); 没启用时整组接口当作不存在。 */
export const hxoaOn = (core: Core): boolean => core.kernel.isEnabled(core.users.ownerId(), HXOA_PLUGIN);
const gated = (h: Handler): Handler => (c) => (hxoaOn(c.core) ? h(c) : githubOff(c.req));
// 只有主人能用: 能在远程机器上跑命令, 不开放给 Agent 的 key
const r = (method: string, path: string, h: Handler) => route(method, path, OWNER, gated(h));
const idOf = (c: ReqCtx) => decodeURIComponent(c.params[0] ?? "");
const q = (c: ReqCtx, k: string) => c.url.searchParams.get(k) ?? "";
const pos = (s: string) => (/^\d+$/.test(s) && Number(s) > 0 ? Number(s) : undefined);

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
    return json({ ok: true });
  }),
  r(DELETE, PATH_HXOA_ONE, async (c) => json({ ok: c.core.hxoa.remove(idOf(c)) })),
  r(GET, PATH_HXOA_LS, async (c) => {
    const depth = Math.min(MAX_DEPTH, pos(q(c, "depth")) ?? 1);
    return json(await c.core.hxoa.ls(idOf(c), q(c, "path"), depth));
  }),
  r(GET, PATH_HXOA_READ, async (c) => {
    const path = q(c, "path");
    if (!path) return fail(400, "path 必填");
    return json(await c.core.hxoa.read(idOf(c), path, pos(q(c, "start")), pos(q(c, "end"))));
  }),
  r(POST, PATH_HXOA_MKDIR, async (c) => {
    const path = parseHxoaMkdir(await readJson(c.req));
    if (!path) return fail(400, "path 是工作区内的相对路径, 不能含 ..");
    return json(await c.core.hxoa.mkdir(idOf(c), path));
  }),
  r(POST, PATH_HXOA_EXEC, async (c) => {
    const input = parseHxoaExec(await readJson(c.req));
    if (typeof input === "string") return fail(400, input);
    return json(await c.core.hxoa.exec(idOf(c), input));
  }),
];
