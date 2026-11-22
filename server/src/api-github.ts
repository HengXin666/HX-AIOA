import { PATH_GITHUB_REPO, PATH_GITHUB_REPOS, PATH_GITHUB_SYNC } from "@hx-aioa/protocol";
import { CODE_NOT_CONFIGURED, CODE_NOT_FOUND, ERR_NO_GITHUB_TOKEN, ERR_NO_RESOURCE, GET, POST } from "./constants";
import { OWNER, type Route, route } from "./core";
import { fail, json } from "./http";

const READ = "events:read";

export const GITHUB_ROUTES: Route[] = [
  route(GET, PATH_GITHUB_REPOS, READ, async (c) => json(await c.core.github.repos())),
  route(GET, PATH_GITHUB_REPO, READ, (c) => {
    const repo = `${decodeURIComponent(c.params[0] ?? "")}/${decodeURIComponent(c.params[1] ?? "")}`;
    const d = c.core.github.detail(repo);
    return d ? json(d) : fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  }),
  route(POST, PATH_GITHUB_SYNC, OWNER, async (c) => {
    const r = await c.core.github.sync();
    if (!r) return fail(400, ERR_NO_GITHUB_TOKEN, CODE_NOT_CONFIGURED);
    return json(r);
  }),
];
