import {
  PATH_AUDIT,
  PATH_AUTH_LOGIN,
  PATH_AUTH_LOGOUT,
  PATH_AUTH_REFRESH,
  PATH_GROUP,
  PATH_GROUPS,
  PATH_INVITES,
  PATH_JOIN,
  PATH_ME,
  PATH_ME_DEVICE,
  PATH_ME_PASSWORD,
  PATH_SETUP,
  PATH_USER,
  PATH_USER_APPROVE,
  PATH_USERS,
} from "@hx-aioa/protocol";
import { credentialOf, isOwnerToken } from "../auth";
import { CODE_UNAUTHORIZED, DELETE, ERR_UNAUTHORIZED, GET, PATCH, POST } from "../constants";
import { ApiFail, fail, json, readJson } from "../http";
import { ACTOR_LEGACY } from "./constants";
import * as admin from "./routes-admin";
import { type Body, join, login, setup } from "./routes-public";
import type { Accounts } from "./service";

type Ctx = { a: Accounts; req: Request; url: URL; id: string; body: () => Promise<Body>; who: () => Promise<admin.AcctWho> };
type AcctRoute = { method: string; re: RegExp; run: (c: Ctx) => Promise<Response> | Response };

const r = (method: string, path: string, run: AcctRoute["run"]): AcctRoute => ({ method, re: new RegExp(`^${path.replace(/\{[^}]+\}/g, "([^/]+)")}$`), run });

const ROUTES: AcctRoute[] = [
  r(GET, PATH_SETUP, (c) => json({ done: Boolean(c.a.dir.owner()) })),
  r(POST, PATH_SETUP, async (c) => setup(c.a, c.a.setupCode(), await c.body())),
  r(POST, PATH_AUTH_LOGIN, async (c) => login(c.a, await c.body())),
  r(POST, PATH_AUTH_REFRESH, async (c) => json(await c.a.refresh(String((await c.body()).refresh ?? "")))),
  r(POST, PATH_JOIN, async (c) => join(c.a, await c.body())),
  r(POST, PATH_AUTH_LOGOUT, async (c) => admin.logout(c.a, await c.who())),
  r(GET, PATH_ME, async (c) => admin.me(c.a, await c.who())),
  r(POST, PATH_ME_PASSWORD, async (c) => admin.changePassword(c.a, await c.who(), await c.body())),
  r(DELETE, PATH_ME_DEVICE, async (c) => admin.dropDevice(c.a, await c.who(), c.id)),
  r(GET, PATH_INVITES, async (c) => admin.listInvites(c.a, await c.who())),
  r(POST, PATH_INVITES, async (c) => admin.createInvite(c.a, await c.who(), await c.body())),
  r(DELETE, `${PATH_INVITES}/{id}`, async (c) => admin.dropInvite(c.a, await c.who(), c.id)),
  r(GET, PATH_USERS, async (c) => admin.listUsers(c.a, await c.who())),
  r(PATCH, PATH_USER, async (c) => admin.patchUser(c.a, await c.who(), c.id, await c.body())),
  r(POST, PATH_USER_APPROVE, async (c) => admin.approve(c.a, await c.who(), c.id)),
  r(DELETE, PATH_USER, async (c) => admin.deleteUser(c.a, await c.who(), c.id)),
  r(GET, PATH_AUDIT, async (c) => admin.audit(c.a, await c.who(), c.url)),
  r(GET, PATH_GROUPS, async (c) => admin.listGroups(c.a, await c.who())),
  r(POST, PATH_GROUPS, async (c) => admin.createGroup(c.a, await c.who(), await c.body())),
  r(PATCH, PATH_GROUP, async (c) => admin.patchGroup(c.a, await c.who(), c.id, await c.body())),
  r(DELETE, PATH_GROUP, async (c) => admin.dropGroup(c.a, await c.who(), c.id)),
];

const unauthorized = () => new ApiFail(401, CODE_UNAUTHORIZED, ERR_UNAUTHORIZED);

async function whoOf(a: Accounts, req: Request, url: URL, legacyToken: string): Promise<admin.AcctWho> {
  const cred = credentialOf(req, url);
  if (isOwnerToken(cred, legacyToken)) return { user: a.dir.owner(), role: "owner", actor: ACTOR_LEGACY };
  const s = await a.resolve(cred);
  if (!s) throw unauthorized();
  return { user: s.user, role: s.user.role, session: s.session, actor: s.user.id };
}

// 账号接口只在主 Hub 处理; 不是账号路径时返回 null, 交给事件等接口
export async function handleAccounts(a: Accounts, req: Request, url: URL, legacyToken: string): Promise<Response | null> {
  for (const route of ROUTES) {
    if (route.method !== req.method) continue;
    const m = route.re.exec(url.pathname);
    if (!m) continue;
    const ctx: Ctx = {
      a,
      req,
      url,
      id: decodeURIComponent(m[1] ?? ""),
      body: async () => {
        const b = await readJson(req);
        if (typeof b !== "object" || b === null) throw new ApiFail(400, "bad_request", "请求体必须是 JSON 对象");
        return b as Body;
      },
      who: () => whoOf(a, req, url, legacyToken),
    };
    try {
      return await route.run(ctx);
    } catch (e) {
      if (e instanceof ApiFail) return fail(e.status, e.message, e.code);
      throw e;
    }
  }
  return null;
}
