import { GITHUB_BRANCH_DEFAULT_DAYS, GITHUB_BRANCH_MAX_DAYS, PATH_GITHUB_BRANCHES, GITHUB_DAILY_DEFAULT_DAYS, GITHUB_DAILY_MAX_DAYS, PATH_GITHUB_ACTIVITY, PATH_GITHUB_AVAILABLE, PATH_GITHUB_DAILY, PATH_GITHUB_REPO, PATH_GITHUB_REPOS, PATH_GITHUB_SYNC, PATH_GITHUB_TRACKED } from "@hx-aioa/protocol";
import { CODE_NOT_CONFIGURED, CODE_NOT_FOUND, ERR_NO_GITHUB_TOKEN, ERR_NO_RESOURCE, GET, POST, PUT } from "./constants";
import { type Handler, type Need, OWNER, type Route, route } from "./core";
import { gated } from "./github/gate";
import { fail, json, readJson } from "./http";

const READ = "events:read";
const DAY_MS = 24 * 3600_000;
const MAX_RANGE_MS = 31 * DAY_MS;
const TZ_MAX_MIN = 14 * 60;
const MAX_TRACKED = 100;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const noToken = () => fail(400, ERR_NO_GITHUB_TOKEN, CODE_NOT_CONFIGURED);
// 主人没启用 hengxin666.github 插件时整组接口 404, 云 Agent 的 key 也一样
const gh = (method: string, path: string, need: Need, h: Handler) => route(method, path, need, gated(h));

export const GITHUB_ROUTES: Route[] = [
  gh(GET, PATH_GITHUB_REPOS, READ, async (c) => json(await c.core.github.repos())),
  gh(GET, PATH_GITHUB_REPO, READ, async (c) => {
    const repo = `${decodeURIComponent(c.params[0] ?? "")}/${decodeURIComponent(c.params[1] ?? "")}`;
    const d = await c.core.github.detail(repo);
    return d ? json(d) : fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  }),
  gh(POST, PATH_GITHUB_SYNC, OWNER, async (c) => {
    const r = await c.core.github.sync();
    return r ? json(r) : noToken();
  }),
  gh(GET, PATH_GITHUB_AVAILABLE, OWNER, async (c) => {
    const r = await c.core.github.available();
    return r ? json(r) : noToken();
  }),
  gh(PUT, PATH_GITHUB_TRACKED, OWNER, async (c) => {
    const body = (await readJson(c.req)) as { repos?: unknown } | undefined;
    const repos = Array.isArray(body?.repos) ? body.repos.filter((r): r is string => typeof r === "string" && REPO_RE.test(r)) : null;
    if (!repos || repos.length > MAX_TRACKED) return fail(400, `repos 需为 owner/name 数组, 最多 ${MAX_TRACKED} 个`);
    return json(await c.core.github.setTracked(repos));
  }),
  // 默认最近 24 小时; 客户端按本地时区算出当天零点传 since
  gh(GET, PATH_GITHUB_ACTIVITY, READ, async (c) => {
    const now = Date.now();
    const until = Number(c.url.searchParams.get("until")) || now + 60_000;
    const since = Number(c.url.searchParams.get("since")) || until - DAY_MS;
    if (since >= until || until - since > MAX_RANGE_MS) return fail(400, "since / until 范围错误, 最长 31 天");
    return json(await c.core.github.activity(since, until));
  }),
  // 柱状图: days 天 (默认 14, 最多 30), tz 为客户端时区东区分钟数 (北京时间 480)
  gh(GET, PATH_GITHUB_DAILY, READ, async (c) => {
    const days = Math.min(GITHUB_DAILY_MAX_DAYS, Math.max(1, Number(c.url.searchParams.get("days")) || GITHUB_DAILY_DEFAULT_DAYS));
    const tz = Math.max(-TZ_MAX_MIN, Math.min(TZ_MAX_MIN, Number(c.url.searchParams.get("tz")) || 0));
    return json(await c.core.github.daily(days, tz));
  }),
  // 未合入分支: days 天内有提交 (默认 30, 最多 90); fresh=1 跳过 10 分钟缓存
  gh(GET, PATH_GITHUB_BRANCHES, READ, async (c) => {
    const days = Math.min(GITHUB_BRANCH_MAX_DAYS, Math.max(1, Number(c.url.searchParams.get("days")) || GITHUB_BRANCH_DEFAULT_DAYS));
    const r = await c.core.github.branches(days, c.url.searchParams.get("fresh") === "1");
    return r ? json(r) : noToken();
  }),
];
