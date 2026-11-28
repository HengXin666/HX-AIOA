import assert from "node:assert/strict";
import { test } from "node:test";
import { TrendStore, emptyTrend, trendOf, trendStep } from "../src/github/trend";
import { type TrendVars, parseTrend } from "../src/github/trend-fetch";
import { GithubService } from "../src/github/service";
import { memKv } from "./github-kv";
import { memSql } from "./sql";

const NOW = Date.parse("2026-11-27T20:30:00Z"); // 北京时间 11-28 04:30, 周六
const TZ = "Asia/Shanghai";
const label = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);

const item = (id: string, created: string, updated: string, extra: Record<string, unknown> = {}) => ({
  id, number: 1, url: `u/${id}`, createdAt: created, updatedAt: updated, closedAt: null, repository: { nameWithOwner: "a/b" }, comments: { totalCount: 2 }, ...extra,
});

const FULL = {
  viewer: {
    contributionsCollection: {
      commitContributionsByRepository: [{ repository: { nameWithOwner: "a/b" }, contributions: { nodes: [{ occurredAt: "2026-11-27T08:00:00Z", commitCount: 62 }, { occurredAt: "2026-11-16T08:00:00Z", commitCount: 5 }] } }],
      pullRequestReviewContributions: { nodes: [{ occurredAt: "2026-11-20T03:00:00Z", pullRequestReview: { url: "rv1" }, pullRequest: { number: 3, repository: { nameWithOwner: "a/b" } } }] },
    },
    created: { nodes: [{ nameWithOwner: "me/new", url: "w", description: "d", isPrivate: true, isFork: false, createdAt: "2026-11-26T07:52:00Z", parent: null }, { nameWithOwner: "me/fk", url: "f", description: "", isPrivate: false, isFork: true, createdAt: "2026-11-20T01:00:00Z", parent: { nameWithOwner: "up/fk" } }] },
    starredRepositories: { edges: [{ starredAt: "2026-11-27T14:40:00Z", node: { nameWithOwner: "x/y", url: "s", description: "", stargazerCount: 143 } }] },
    recent: { pageInfo: { startCursor: "C1", hasPreviousPage: true }, nodes: [{ id: "IC1", createdAt: "2026-11-27T18:29:00Z", url: "c", pullRequest: null, repository: { nameWithOwner: "a/b" } }, { id: "IC2", createdAt: "2026-11-25T01:00:00Z", url: "c", pullRequest: { number: 2 }, repository: { nameWithOwner: "a/b" } }] },
  },
  search: {
    nodes: [
      item("I_1", "2026-11-15T02:00:00Z", "2026-11-27T14:48:00Z", { closedAt: "2026-11-27T14:48:00Z" }),
      item("PR_2", "2026-11-26T01:00:00Z", "2026-11-26T02:00:00Z", { closedAt: "2026-11-26T02:00:00Z", mergedAt: "2026-11-26T02:00:00Z" }),
      item("PR_3", "2026-11-24T01:00:00Z", "2026-11-24T05:00:00Z", { closedAt: "2026-11-24T05:00:00Z", mergedAt: null }),
      item("I_old", "2026-05-01T00:00:00Z", "2026-11-27T19:00:00Z", { closedAt: "2026-11-27T19:00:00Z" }),
    ],
  },
};

test("走势解析: 提交按 GitHub 日期, PR 区分合入与关闭, 评论分 PR / Issue (#142)", () => {
  const p = parseTrend(FULL, true);
  assert.equal(p.found, 4);
  assert.equal(p.cmt?.before, "C1");
  assert.equal(p.cmt?.more, true);
  const { days, weeks } = trendOf(p.rows, label(NOW), label);
  assert.equal(days.points.length, 14);
  assert.equal(days.points.at(-1)?.label, "2026-11-28");
  const at = (d: string) => days.points.find((x) => x.label === d)!;
  assert.equal(at("2026-11-27").commits, 62);
  assert.equal(at("2026-11-16").commits, 5);
  assert.equal(at("2026-11-27").issueClosed, 1);
  // 北京时间 11-28 02:29 的评论, 11-28 03:00 关的老 Issue
  assert.equal(at("2026-11-28").issueComments, 1);
  assert.equal(at("2026-11-28").issueClosed, 1);
  assert.equal(at("2026-11-25").prComments, 1);
  assert.equal(at("2026-11-26").prMerged, 1);
  assert.equal(at("2026-11-26").prOpened, 1);
  assert.equal(at("2026-11-24").prClosed, 1);
  assert.equal(at("2026-11-24").prMerged, 0);
  assert.equal(at("2026-11-20").reviews, 1);
  assert.equal(at("2026-11-15").issueOpened, 1);
  // 范围内新开的 I_1 PR_2 PR_3 各 2 条评论, 5 月开的不算
  assert.equal(days.received, 6);
  // 12 周, 周一起; 今天所在的周 = 11-23
  assert.equal(weeks.points.length, 12);
  assert.equal(weeks.points.at(-1)?.label, "2026-11-23");
  assert.equal(weeks.points.at(-1)?.commits, 62);
  assert.equal(weeks.points.at(-2)?.commits, 5);
  assert.equal(weeks.points.reduce((n, w) => n + w.issueClosed, 0), 2);
});

test("走势同步: 第一页带全部, 满页接着翻, 评论往前补到 12 周前就停; 重复同步不重写 (#142)", async () => {
  const store = new TrendStore(memSql());
  const st = emptyTrend(NOW);
  const asked: TrendVars[] = [];
  const many = Array.from({ length: 100 }, (_, i) => item(`I_m${i}`, "2026-10-01T00:00:00Z", new Date(Date.parse("2026-10-01T00:00:00Z") + i * 1000).toISOString()));
  const fake = async (_t: string, v: TrendVars) => {
    asked.push(v);
    if (asked.length === 1) return { ...FULL, search: { nodes: many } };
    return { viewer: { older: { pageInfo: { startCursor: "C0", hasPreviousPage: true }, nodes: [{ id: "IC0", createdAt: "2026-08-01T00:00:00Z", url: "c", pullRequest: null, repository: { nameWithOwner: "a/b" } }] } }, search: FULL.search };
  };
  await trendStep(store, "t", "me", st, NOW, 4, fake);
  assert.equal(asked.length, 2);
  assert.equal(asked[0]?.full, true);
  assert.equal(asked[0]?.older, false);
  assert.match(asked[0]?.q ?? "", /^author:me updated:>=2026-08-21T20:30:00Z sort:updated-asc$/);
  assert.equal(asked[1]?.full, false);
  assert.equal(asked[1]?.before, "C1");
  assert.match(asked[1]?.q ?? "", /updated:>=2026-10-01T00:01:39Z/);
  assert.equal(st.caught, true);
  assert.equal(st.cmtDone, true);
  assert.ok(st.at);
  // 追上之后只要一页; 内容没变不写
  asked.length = 0;
  const again = await trendStep(store, "t", "me", st, NOW, 4, async (t, v) => (asked.push(v), FULL));
  assert.equal(asked.length, 1);
  assert.equal(again, 0);
  assert.equal(store.footprints("star")[0]?.body.repo, "x/y");
  // star 取消后整份替换掉
  await trendStep(store, "t", "me", st, NOW, 1, async () => ({ ...FULL, viewer: { ...FULL.viewer, starredRepositories: { edges: [] } } }));
  assert.equal(store.footprints("star").length, 0);
  assert.equal(store.footprints("repo").length, 2);
});

test("单仓库走势: repo 只算这个仓库的行, 不带足迹, ETag 分开 (#144)", async () => {
  const sql = memSql();
  const kv = memKv();
  const store = new TrendStore(sql);
  store.put(parseTrend(FULL, true).rows, true, NOW);
  store.put([{ k: "c:o/x:2026-11-27", kind: "commit", ts: NOW, body: { repo: "o/x", day: "2026-11-27", n: 9 } }], false, NOW);
  await kv.storage.put("githubTrend", { ...emptyTrend(NOW), at: NOW });
  const svc = new GithubService({} as never, sql, kv.storage, { sources: () => [] } as never);
  const all = await svc.trend(TZ, NOW);
  const one = await svc.trend(TZ, NOW, "A/B");
  const sum = (t: typeof all) => t.body.days.points.reduce((n, p) => n + p.commits, 0);
  assert.equal(sum(all), 76);
  assert.equal(sum(one), 67);
  assert.equal(one.body.days.points.find((p) => p.label === "2026-11-26")?.prMerged, 1);
  assert.deepEqual(one.body.created, []);
  assert.ok(all.body.created.length > 0);
  assert.notEqual(one.tag, all.tag);
});
