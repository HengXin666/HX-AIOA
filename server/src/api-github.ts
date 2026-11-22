import { PATH_GITHUB_ACTIVITY, PATH_GITHUB_AVAILABLE, PATH_GITHUB_REPO, PATH_GITHUB_REPOS, PATH_GITHUB_SYNC, PATH_GITHUB_TRACKED } from "@hx-aioa/protocol";
import { CODE_NOT_CONFIGURED, CODE_NOT_FOUND, ERR_NO_GITHUB_TOKEN, ERR_NO_RESOURCE, GET, POST, PUT } from "./constants";
import { OWNER, type Route, route } from "./core";
import { fail, json, readJson } from "./http";

const READ = "events:read";
const DAY_MS = 24 * 3600_000;
const MAX_RANGE_MS = 31 * DAY_MS;
const MAX_TRACKED = 100;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const noToken = () => fail(400, ERR_NO_GITHUB_TOKEN, CODE_NOT_CONFIGURED);

export const GITHUB_ROUTES: Route[] = [
  route(GET, PATH_GITHUB_REPOS, READ, async (c) => json(await c.core.github.repos())),
  route(GET, PATH_GITHUB_REPO, READ, async (c) => {
    const repo = `${decodeURIComponent(c.params[0] ?? "")}/${decodeURIComponent(c.params[1] ?? "")}`;
    const d = await c.core.github.detail(repo);
    return d ? json(d) : fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  }),
  route(POST, PATH_GITHUB_SYNC, OWNER, async (c) => {
    const r = await c.core.github.sync();
    return r ? json(r) : noToken();
  }),
  route(GET, PATH_GITHUB_AVAILABLE, OWNER, async (c) => {
    const r = await c.core.github.available();
    return r ? json(r) : noToken();
  }),
  route(PUT, PATH_GITHUB_TRACKED, OWNER, async (c) => {
    const body = (await readJson(c.req)) as { repos?: unknown } | undefined;
    const repos = Array.isArray(body?.repos) ? body.repos.filter((r): r is string => typeof r === "string" && REPO_RE.test(r)) : null;
    if (!repos || repos.length > MAX_TRACKED) return fail(400, `repos 需为 owner/name 数组, 最多 ${MAX_TRACKED} 个`);
    return json(await c.core.github.setTracked(repos));
  }),
  // 默认最近 24 小时; 客户端按本地时区算出当天零点传 since
  route(GET, PATH_GITHUB_ACTIVITY, READ, async (c) => {
    const now = Date.now();
    const until = Number(c.url.searchParams.get("until")) || now + 60_000;
    const since = Number(c.url.searchParams.get("since")) || until - DAY_MS;
    if (since >= until || until - since > MAX_RANGE_MS) return fail(400, "since / until 范围错误, 最长 31 天");
    return json(await c.core.github.activity(since, until));
  }),
];
