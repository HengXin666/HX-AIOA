import { GITHUB_BRANCH_DEFAULT_DAYS, GITHUB_BRANCH_MAX_DAYS, PATH_GITHUB_BRANCHES, GITHUB_DAILY_DEFAULT_DAYS, GITHUB_DAILY_MAX_DAYS, PATH_GITHUB_ACTIVITY, PATH_GITHUB_AVAILABLE, PATH_GITHUB_DAILY, GITHUB_HISTORY_KINDS, type GithubHistoryKind, PATH_GITHUB_HEATMAP, PATH_GITHUB_HISTORY, PATH_GITHUB_TREND, PATH_GITHUB_REPO, PATH_GITHUB_REPOS, PATH_GITHUB_SYNC, PATH_GITHUB_TRACKED } from "@hx-aioa/protocol";
import { CODE_NOT_CONFIGURED, CODE_NOT_FOUND, ERR_NO_GITHUB_TOKEN, ERR_NO_RESOURCE, GET, POST, PUT } from "./constants";
import { type Handler, type Need, OWNER, type Route, route } from "./core";
import { gated } from "./github/gate";
import { HistoryFail } from "./github/history";
import { etagged, fail, json, readJson } from "./http";

const READ = "events:read";
const DAY_MS = 24 * 3600_000;
const MAX_RANGE_MS = 31 * DAY_MS;
const TZ_MAX_MIN = 14 * 60;
const MAX_TRACKED = 100;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
// 热力图可选的年份: GitHub 2008 年上线
const MIN_YEAR = 2008;
const MAX_YEAR = 9999;
const CURSOR_RE = /^\d+$/;
const noToken = () => fail(400, ERR_NO_GITHUB_TOKEN, CODE_NOT_CONFIGURED);
// 主人没启用 hengxin666.github 插件时整组接口 404, 云 Agent 的 key 也一样
const gh = (method: string, path: string, need: Need, h: Handler) => route(method, path, need, gated(h));

const repoOf = (p: string[]) => `${decodeURIComponent(p[0] ?? "")}/${decodeURIComponent(p[1] ?? "")}`;

export const GITHUB_ROUTES: Route[] = [
  gh(GET, PATH_GITHUB_REPOS, READ, async (c) => json(await c.core.github.repos())),
  gh(GET, PATH_GITHUB_REPO, READ, async (c) => {
    const d = await c.core.github.detail(repoOf(c.params));
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
  // 提交热力图 (#134): 默认最近 140 天, year=YYYY 看那一年 (全部历史靠回填); 没变时 304
  // tz=IANA 时区名 (#139): 按设备时区算今天与实时提交; 不传或不认识时用主人设置的时区
  gh(GET, PATH_GITHUB_HEATMAP, READ, async (c) => {
    const y = Number(c.url.searchParams.get("year"));
    const year = Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR ? y : undefined;
    const zone = c.url.searchParams.get("tz") ?? "";
    const h = await c.core.github.heatmap(validZone(zone) ? zone : await c.core.config.tz(), Date.now(), year);
    return etagged(c.req, h.tag, () => h.map);
  }),
  // 走势 (#142): GitHub 页全部折线 / 混合图与足迹一次给全, 只读库; tz=IANA 时区名, 不认识时用主人设置的; 没变 304
  gh(GET, PATH_GITHUB_TREND, READ, async (c) => {
    const zone = c.url.searchParams.get("tz") ?? "";
    const t = await c.core.github.trend(validZone(zone) ? zone : await c.core.config.tz());
    return etagged(c.req, t.tag, () => t.body);
  }),
  // 未合入分支: days 天内有提交 (默认 30, 最多 90); fresh=1 跳过 10 分钟缓存
  gh(GET, PATH_GITHUB_BRANCHES, READ, async (c) => {
    const days = Math.min(GITHUB_BRANCH_MAX_DAYS, Math.max(1, Number(c.url.searchParams.get("days")) || GITHUB_BRANCH_DEFAULT_DAYS));
    const r = await c.core.github.branches(days, c.url.searchParams.get("fresh") === "1");
    return r ? json(r) : noToken();
  }),
  // 仓库历史 (#134): kind=commit|pr|issue|release, before 为上一页的 next, 一直往前翻到 next 为空
  gh(GET, PATH_GITHUB_HISTORY, READ, async (c) => {
    const kind = c.url.searchParams.get("kind") ?? GITHUB_HISTORY_KINDS[0];
    const before = c.url.searchParams.get("before") ?? "";
    if (!(GITHUB_HISTORY_KINDS as readonly string[]).includes(kind)) return fail(400, `kind 需为 ${GITHUB_HISTORY_KINDS.join(" / ")}`);
    if (before && !CURSOR_RE.test(before)) return fail(400, "before 需为上一页返回的 next");
    try {
      const r = await c.core.github.history(repoOf(c.params), kind as GithubHistoryKind, before);
      return r ? json(r) : noToken();
    } catch (e) {
      if (!(e instanceof HistoryFail)) throw e;
      return e.status === 404 ? fail(404, e.message, CODE_NOT_FOUND) : fail(e.status, e.message);
    }
  }),
];

/** 是不是运行时认识的 IANA 时区名 (Asia/Shanghai); 空串与乱填都不算。 */
export function validZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
