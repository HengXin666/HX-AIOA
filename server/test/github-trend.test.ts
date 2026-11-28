import assert from "node:assert/strict";
import { test } from "node:test";
import { TREND_KEEP_MS, type TrendState, TrendStore, emptyTrend, trendDone, trendOf, trendStep } from "../src/github/trend";
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

const ISSUES = {
  I_1: item("I_1", "2026-11-15T02:00:00Z", "2026-11-27T14:48:00Z", { closedAt: "2026-11-27T14:48:00Z" }),
  PR_2: item("PR_2", "2026-11-26T01:00:00Z", "2026-11-26T02:00:00Z", { closedAt: "2026-11-26T02:00:00Z", mergedAt: "2026-11-26T02:00:00Z" }),
  PR_3: item("PR_3", "2026-11-24T01:00:00Z", "2026-11-24T05:00:00Z", { closedAt: "2026-11-24T05:00:00Z", mergedAt: null }),
  I_old: item("I_old", "2026-05-01T00:00:00Z", "2026-11-27T19:00:00Z", { closedAt: "2026-11-27T19:00:00Z" }),
};

const FULL = {
  viewer: {
    contributionsCollection: {
      commitContributionsByRepository: [{ repository: { nameWithOwner: "a/b" }, contributions: { nodes: [{ occurredAt: "2026-11-27T08:00:00Z", commitCount: 62 }, { occurredAt: "2026-11-16T08:00:00Z", commitCount: 5 }] } }],
      pullRequestReviewContributions: { nodes: [{ occurredAt: "2026-11-20T03:00:00Z", pullRequestReview: { url: "rv1" }, pullRequest: { number: 3, repository: { nameWithOwner: "a/b" } } }] },
    },
    back: {
      issueContributions: { pageInfo: { endCursor: "I1", hasNextPage: false }, nodes: [{ occurredAt: ISSUES.I_1.createdAt, issue: ISSUES.I_1 }] },
      pullRequestContributions: { pageInfo: { endCursor: "P1", hasNextPage: false }, nodes: [{ occurredAt: ISSUES.PR_2.createdAt, pullRequest: ISSUES.PR_2 }] },
    },
    created: { nodes: [{ nameWithOwner: "me/new", url: "w", description: "d", isPrivate: true, isFork: false, createdAt: "2026-11-26T07:52:00Z", parent: null }, { nameWithOwner: "me/fk", url: "f", description: "", isPrivate: false, isFork: true, createdAt: "2026-11-20T01:00:00Z", parent: { nameWithOwner: "up/fk" } }] },
    starredRepositories: { edges: [{ starredAt: "2026-11-27T14:40:00Z", node: { nameWithOwner: "x/y", url: "s", description: "", stargazerCount: 143 } }] },
    recent: { pageInfo: { startCursor: "C1", hasPreviousPage: true }, nodes: [{ id: "IC1", createdAt: "2026-11-27T18:29:00Z", url: "c", pullRequest: null, repository: { nameWithOwner: "a/b" } }, { id: "IC2", createdAt: "2026-11-25T01:00:00Z", url: "c", pullRequest: { number: 2 }, repository: { nameWithOwner: "a/b" } }] },
    myIssues: { nodes: [ISSUES.I_1, ISSUES.I_old] },
    myPrs: { nodes: [ISSUES.PR_2, ISSUES.PR_3] },
  },
};

test("走势解析: 提交按 GitHub 日期, PR 区分合入与关闭, 评论分 PR / Issue (#142)", () => {
  const p = parseTrend(FULL, true);
  assert.equal(p.ic?.more, false);
  assert.equal(p.rows.filter((r) => r.k === "I_1").length, 1);
  assert.equal(p.pc?.after, "P1");
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

test("走势同步: 第一页带全部, 评论与我开的 Issue / PR 往前补到 12 周前就停; 重复同步不重写 (#142 #145)", async () => {
  const store = new TrendStore(memSql());
  const st = emptyTrend();
  const asked: TrendVars[] = [];
  const OCT = "2026-10-01T00:00:00Z";
  const AUG = "2026-08-01T00:00:00Z";
  const many = Array.from({ length: 100 }, (_, i) => ({ occurredAt: OCT, pullRequest: item(`PR_m${i}`, OCT, OCT, { mergedAt: null }) }));
  const first = { viewer: { ...FULL.viewer, back: { ...FULL.viewer.back, pullRequestContributions: { pageInfo: { endCursor: "P100", hasNextPage: true }, nodes: many } } } };
  const fake = async (_t: string, v: TrendVars) => {
    asked.push(v);
    if (asked.length === 1) return first;
    return {
      viewer: {
        older: { pageInfo: { startCursor: "C0", hasPreviousPage: true }, nodes: [{ id: "IC0", createdAt: AUG, url: "c", pullRequest: null, repository: { nameWithOwner: "a/b" } }] },
        back: { pullRequestContributions: { pageInfo: { endCursor: "P200", hasNextPage: true }, nodes: [{ occurredAt: AUG, pullRequest: item("PR_x", AUG, AUG, { mergedAt: null }) }] } },
      },
    };
  };
  await trendStep(store, "t", st, NOW, 4, fake);
  assert.equal(asked.length, 2);
  // 第一次同步从贡献集合最新一页起回补, 不带游标
  assert.deepEqual([asked[0]?.full, asked[0]?.older, asked[0]?.back, asked[0]?.ia, asked[0]?.pa], [true, false, true, undefined, undefined]);
  assert.equal(asked[1]?.full, false);
  assert.equal(asked[1]?.before, "C1");
  // Issue 第一页就到底, 只往前翻 PR
  assert.deepEqual([asked[1]?.back, asked[1]?.bi, asked[1]?.bp, asked[1]?.pa], [true, false, true, "P100"]);
  assert.equal(st.cmtDone, true);
  assert.equal(st.pDone, true);
  assert.equal(st.pa, "P200");
  assert.ok(st.at);
  // 100 个 + 最近更新列表里的 PR_2 PR_3; 8 月的 PR_x 超出保留期不写
  assert.equal(store.since(0).filter((r) => r.kind === "pr").length, 102);
  // 补完之后只要一页; 内容没变不写
  asked.length = 0;
  const again = await trendStep(store, "t", st, NOW, 4, async (_t, v) => (asked.push(v), FULL));
  assert.equal(asked.length, 1);
  assert.equal(again, 0);
  assert.equal(store.footprints("star")[0]?.body.repo, "x/y");
  // star 取消后整份替换掉
  await trendStep(store, "t", st, NOW, 1, async () => ({ ...FULL, viewer: { ...FULL.viewer, starredRepositories: { edges: [] } } }));
  assert.equal(store.footprints("star").length, 0);
  assert.equal(store.footprints("repo").length, 2);
});

test("走势同步: 旧状态 (搜索游标) 升级后从最新一页起补我开的 Issue / PR, 补完才算回填完成 (#145)", async () => {
  const store = new TrendStore(memSql());
  const st = { cursor: NOW, caught: true, cmtDone: true } as unknown as TrendState;
  const asked: TrendVars[] = [];
  const back = FULL.viewer.back;
  const page = { viewer: { ...FULL.viewer, back: { ...back, issueContributions: { ...back.issueContributions, pageInfo: { endCursor: "I1", hasNextPage: true } } } } };
  await trendStep(store, "t", st, NOW, 1, async (_t, v) => (asked.push(v), page));
  assert.equal(asked[0]?.back, true);
  assert.equal(trendDone(st), false);
  assert.equal(st.ia, "I1");
  assert.equal(st.pDone, true);
  const end = { viewer: { ...FULL.viewer, back: { issueContributions: { pageInfo: { endCursor: "I2", hasNextPage: false }, nodes: [] } } } };
  await trendStep(store, "t", st, NOW, 1, async (_t, v) => (asked.push(v), end));
  assert.deepEqual([asked[1]?.ia, asked[1]?.bi, asked[1]?.bp], ["I1", true, false]);
  assert.equal(trendDone(st), true);
  const rows = parseTrend(page, true).rows;
  // 同一个 Issue 在贡献集合与最近更新列表里都有, 解析结果按 k 去重
  assert.equal(rows.filter((r) => r.k === "I_1").length, 1);
});

test("单仓库走势: repo 只算这个仓库的行, 不带足迹, ETag 分开 (#144)", async () => {
  const sql = memSql();
  const kv = memKv();
  const store = new TrendStore(sql);
  store.put(parseTrend(FULL, true).rows, true, NOW);
  store.put([{ k: "c:o/x:2026-11-27", kind: "commit", ts: NOW, body: { repo: "o/x", day: "2026-11-27", n: 9 } }], false, NOW);
  await kv.storage.put("githubTrend", { ...emptyTrend(), at: NOW });
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

test("走势同步: 超出保留期的旧提交不写, 数据没变时第二次同步写入 0 行 (#145)", async () => {
  const sql = memSql();
  const store = new TrendStore(sql);
  const st = emptyTrend();
  const DAY = 24 * 3600_000;
  // 贡献集合拉回的 200 天前那天: 以前每次同步都先插后删, 一天 48 次 cron 白写上千行
  const oldDay = new Date(NOW - 200 * DAY).toISOString().slice(0, 10);
  const cc = FULL.viewer.contributionsCollection;
  const nodes = [...cc.commitContributionsByRepository[0]!.contributions.nodes, { occurredAt: `${oldDay}T07:00:00Z`, commitCount: 3 }];
  const page = { ...FULL, viewer: { ...FULL.viewer, contributionsCollection: { ...cc, commitContributionsByRepository: [{ repository: { nameWithOwner: "a/b" }, contributions: { nodes } }] } } };
  const asked: TrendVars[] = [];
  const fake = async (_t: string, v: TrendVars) => (asked.push(v), page);
  const first = await trendStep(store, "t", st, NOW, 1, fake);
  assert.ok(first > 0);
  assert.equal(sql.exec("SELECT 1 FROM gh_trend WHERE k = ?", `c:a/b:${oldDay}`).toArray().length, 0);
  // 只向 GitHub 要保留期内的贡献
  assert.ok(Date.parse(asked[0]!.from) >= NOW - TREND_KEEP_MS);
  const second = await trendStep(store, "t", st, NOW + 30 * 60_000, 1, fake);
  assert.equal(second, 0);
});

test("走势: Issue 不计划做 / 重复关闭算未完成, 其余关闭算完成 (#145)", () => {
  const closed = (id: string, reason: string | null) => item(id, "2026-11-26T01:00:00Z", "2026-11-27T01:00:00Z", { closedAt: "2026-11-27T01:00:00Z", stateReason: reason });
  const data = { viewer: { myIssues: { nodes: [closed("I_a", "COMPLETED"), closed("I_b", "NOT_PLANNED"), closed("I_c", "DUPLICATE"), closed("I_d", null)] } } };
  const { days } = trendOf(parseTrend(data, true).rows, label(NOW), label);
  const p = days.points.find((x) => x.label === "2026-11-27")!;
  assert.equal(p.issueClosed, 2);
  assert.equal(p.issueDropped, 2);
});
