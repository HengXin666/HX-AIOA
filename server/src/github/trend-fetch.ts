import { s } from "../adapters/types";
import { GITHUB_USER_AGENT } from "../constants";
import { type Obj, forkOf, num, obj } from "./map";

// 走势 (#142): 一次 GraphQL 拿全 提交 (按仓库按天), 评审, 新建仓库, star, 我的评论, 我开的 Issue / PR。
// 不用搜索 (#145): 服务端的 fine-grained 令牌搜不到我开的 Issue / PR, 改用 viewer 自己的列表与贡献集合。
// 事件 API 只给最近 300 条且推送不带提交数, 热闹时连两天都盖不住, 所以走势不再靠它。
const GRAPHQL = "https://api.github.com/graphql";
export const TREND_PAGE = 100;
// 足迹列表各给几条; 新建仓库直接取账号下最新创建的这么多个 (#144)
export const FOOTPRINT_LIMIT = 20;
// 每次看最近更新的这么多个我开的 Issue / PR, 补上开得早, 最近才关或合入的
export const TREND_RECENT = 50;

const ITEM = `id number url createdAt updatedAt closedAt repository { nameWithOwner } comments { totalCount }`;
// 平时靠 viewer 的最近更新列表 (新开, 关闭, 合入都会更新它); 历史只回补一次, 从贡献集合按开的时间往前翻
const MINE = `issueContributions(first: ${TREND_PAGE}, after: $ia, orderBy: { direction: DESC }) @include(if: $bi) { ...Ic }
      pullRequestContributions(first: ${TREND_PAGE}, after: $pa, orderBy: { direction: DESC }) @include(if: $bp) { ...Pc }`;
export const TREND_QUERY = `query($from: DateTime!, $to: DateTime!, $full: Boolean!, $older: Boolean!, $before: String, $back: Boolean!, $bi: Boolean!, $bp: Boolean!, $ia: String, $pa: String) {
  viewer {
    contributionsCollection(from: $from, to: $to) @include(if: $full) {
      commitContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner } contributions(first: 100, orderBy: { field: OCCURRED_AT, direction: DESC }) { nodes { occurredAt commitCount } } }
      pullRequestReviewContributions(first: 100, orderBy: { direction: DESC }) { nodes { occurredAt pullRequestReview { url } pullRequest { number repository { nameWithOwner } } } }
    }
    back: contributionsCollection(from: $from, to: $to) @include(if: $back) {
      ${MINE}
    }
    created: repositories(first: ${FOOTPRINT_LIMIT}, ownerAffiliations: [OWNER], orderBy: { field: CREATED_AT, direction: DESC }) @include(if: $full) { nodes { nameWithOwner url description isPrivate isFork createdAt parent { nameWithOwner } } }
    starredRepositories(first: 50, orderBy: { field: STARRED_AT, direction: DESC }) @include(if: $full) { edges { starredAt node { nameWithOwner url description stargazerCount } } }
    myIssues: issues(first: ${TREND_RECENT}, orderBy: { field: UPDATED_AT, direction: DESC }) @include(if: $full) { nodes { ${ITEM} } }
    myPrs: pullRequests(first: ${TREND_RECENT}, orderBy: { field: UPDATED_AT, direction: DESC }) @include(if: $full) { nodes { ${ITEM} mergedAt } }
    recent: issueComments(last: 100) @include(if: $full) { ...Cmt }
    older: issueComments(last: 100, before: $before) @include(if: $older) { ...Cmt }
  }
}
fragment Cmt on IssueCommentConnection { pageInfo { startCursor hasPreviousPage } nodes { id createdAt url pullRequest { number } repository { nameWithOwner } } }
fragment Ic on CreatedIssueContributionConnection { pageInfo { endCursor hasNextPage } nodes { occurredAt issue { ${ITEM} } } }
fragment Pc on CreatedPullRequestContributionConnection { pageInfo { endCursor hasNextPage } nodes { occurredAt pullRequest { ${ITEM} mergedAt } } }`;

export type TrendKind = "issue" | "pr" | "cmt" | "commit" | "review" | "repo" | "star";
// 一行一件事, k 唯一: Issue / PR / 评论用节点 id, 提交按 (仓库, 日期), 新建仓库与 star 按仓库名
export type TrendRow = { k: string; kind: TrendKind; ts: number; body: Obj };

export type TrendPage = {
  rows: TrendRow[];
  // 只有完整页才有: 这一次看到的全部新建仓库 / star (用来删掉取消 star 的)
  full: boolean;
  // 更早的评论: 下一页游标, 是否还有, 这一页最早一条的时间
  cmt?: { before?: string; more: boolean; oldest?: number };
  // 贡献集合里我开的 Issue / PR: 往更早翻的游标, 是否还有, 这一页最早开的时间
  ic?: Back;
  pc?: Back;
};

export type Back = { after?: string; more: boolean; oldest?: number };

export type TrendVars = { from: string; to: string; full: boolean; older: boolean; before?: string; back: boolean; bi: boolean; bp: boolean; ia?: string; pa?: string };

const ms = (v: unknown) => Date.parse(s(v)) || 0;
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const repoOf = (v: unknown) => s(obj(v).nameWithOwner);

function itemRow(n: Obj): TrendRow | null {
  const id = s(n.id);
  const repo = repoOf(n.repository);
  const c = ms(n.createdAt);
  if (!id || !repo || !c) return null;
  const pr = id.startsWith("PR_") || "mergedAt" in n;
  const x = ms(n.closedAt);
  const m = ms(n.mergedAt);
  const body: Obj = { repo, n: num(n.number) ?? 0, url: s(n.url), c, cm: num(obj(n.comments).totalCount) ?? 0 };
  if (x) body.x = x;
  if (m) body.m = m;
  // ts 取最后一次动静: 很早开的 Issue 最近才关, 也要留在窗口里
  return { k: id, kind: pr ? "pr" : "issue", ts: Math.max(c, x, m), body };
}

function cmtRows(conn: Obj): TrendRow[] {
  return list(conn.nodes).flatMap((n) => {
    const id = s(n.id);
    const ts = ms(n.createdAt);
    return id && ts ? [{ k: id, kind: "cmt" as const, ts, body: { repo: repoOf(n.repository), pr: n.pullRequest != null, url: s(n.url) } }] : [];
  });
}

/** 贡献连接 → 行与往前翻的游标; field 是节点里装 Issue / PR 的字段。 */
function mineOf(conn: unknown, field: "issue" | "pullRequest", rows: TrendRow[]): Back | undefined {
  if (conn == null) return undefined;
  const c = obj(conn);
  const times: number[] = [];
  for (const n of list(c.nodes)) {
    const r = itemRow(obj(n[field]));
    if (r) rows.push(r);
    const t = ms(n.occurredAt);
    if (t) times.push(t);
  }
  const pi = obj(c.pageInfo);
  return { more: pi.hasNextPage === true, ...(s(pi.endCursor) ? { after: s(pi.endCursor) } : {}), ...(times.length ? { oldest: Math.min(...times) } : {}) };
}

/** GraphQL 返回 → 行; 纯函数, 测试直接喂样例。 */
export function parseTrend(data: Obj, full: boolean): TrendPage {
  const v = obj(data.viewer);
  const rows: TrendRow[] = [];
  const cc = obj(v.contributionsCollection);
  for (const r of list(cc.commitContributionsByRepository)) {
    const repo = repoOf(r.repository);
    for (const n of list(obj(r.contributions).nodes)) {
      // occurredAt 是那天 (提交者本地日期) 的零点换算, 取 UTC 日期就是 GitHub 日历上的那天
      const day = s(n.occurredAt).slice(0, 10);
      const count = num(n.commitCount) ?? 0;
      if (repo && day && count > 0) rows.push({ k: `c:${repo}:${day}`, kind: "commit", ts: ms(n.occurredAt), body: { repo, day, n: count } });
    }
  }
  for (const n of list(obj(cc.pullRequestReviewContributions).nodes)) {
    const url = s(obj(n.pullRequestReview).url);
    const pr = obj(n.pullRequest);
    if (url) rows.push({ k: `r:${url}`, kind: "review", ts: ms(n.occurredAt), body: { repo: repoOf(pr.repository), n: num(pr.number) ?? 0, url } });
  }
  // 新建仓库按账号仓库列表取 (#144): 贡献集合的 repositoryContributions 不含私有仓库, 跟 GitHub 对不上
  for (const r of list(obj(v.created).nodes)) {
    const repo = repoOf(r);
    const f = forkOf(r);
    const body: Obj = { repo, url: s(r.url), d: s(r.description), p: r.isPrivate === true };
    if (f.fork) body.f = true;
    if (f.parent) body.up = f.parent;
    if (repo) rows.push({ k: `new:${repo}`, kind: "repo", ts: ms(r.createdAt), body });
  }
  for (const e of list(obj(v.starredRepositories).edges)) {
    const r = obj(e.node);
    const repo = repoOf(r);
    if (repo) rows.push({ k: `star:${repo}`, kind: "star", ts: ms(e.starredAt), body: { repo, url: s(r.url), d: s(r.description), s: num(r.stargazerCount) ?? 0 } });
  }
  rows.push(...cmtRows(obj(v.recent)));
  const older = obj(v.older);
  rows.push(...cmtRows(older));
  for (const n of [...list(obj(v.myIssues).nodes), ...list(obj(v.myPrs).nodes)]) {
    const r = itemRow(n);
    if (r) rows.push(r);
  }
  const page: TrendPage = { rows: [], full };
  const back = obj(v.back);
  const ic = mineOf(back.issueContributions, "issue", rows);
  const pc = mineOf(back.pullRequestContributions, "pullRequest", rows);
  if (ic) page.ic = ic;
  if (pc) page.pc = pc;
  // 同一个 Issue / PR 可能同时在贡献集合与最近更新列表里, 按 k 去重
  page.rows = [...new Map(rows.map((r) => [r.k, r])).values()];
  // 往前翻评论: 完整页从最近一页的开头起, 之后从上一页的开头起
  const conn = "older" in v ? older : obj(v.recent);
  if ("older" in v || "recent" in v) {
    const pi = obj(conn.pageInfo);
    const times = cmtRows(conn).map((r) => r.ts);
    page.cmt = { more: pi.hasPreviousPage === true, ...(s(pi.startCursor) ? { before: s(pi.startCursor) } : {}), ...(times.length ? { oldest: Math.min(...times) } : {}) };
  }
  return page;
}

export type TrendFetcher = (token: string, vars: TrendVars) => Promise<Obj>;

export const fetchTrend: TrendFetcher = async (token, vars) => {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "User-Agent": GITHUB_USER_AGENT },
    body: JSON.stringify({ query: TREND_QUERY, variables: vars }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
  const b = obj(await res.json());
  const errs = list(b.errors);
  if (errs.length) throw new Error(errs.map((e) => s(e.message)).join("; "));
  return obj(b.data);
};
