import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GITHUB_HISTORY_PAGE } from "@hx-aioa/protocol";
import { HeatYears, KV_HEAT_STATE, type HeatState, backfillOf, backfillStep, emptyState } from "../src/github/backfill";
import { HistoryFail, historyOf, historyPath, historyTtl } from "../src/github/history";
import { GithubService } from "../src/github/service";
import { memKv } from "./github-kv";
import { memSql } from "./sql";

const TZ = "Asia/Shanghai";
const NOW = Date.parse("2026-11-27T22:30:00+08:00");
const DAY = 24 * 3600_000;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: URL };
/** 模拟 GitHub: handler 按 URL 给 [状态, 数据, 剩余额度]。 */
function mockGithub(handler: (u: URL) => [number, unknown, number?]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    calls.push({ url });
    const [status, body, left = 4000] = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { "x-ratelimit-remaining": String(left) } });
  }) as typeof fetch;
  return calls;
}

const commit = (sha: string, at: number) => ({ sha, html_url: `https://github.com/a/b/commit/${sha}`, author: { login: "hx" }, commit: { message: `提交 ${sha}\n\n正文`, author: { date: new Date(at).toISOString(), name: "HX" }, committer: { date: new Date(at).toISOString() } } });

test("历史页: 提交按 until 往前翻, PR / Issue 用搜索按创建时间, 发布按页码 (#134)", () => {
  assert.equal(historyPath("a/b", "commit", ""), `/repos/a/b/commits?per_page=${GITHUB_HISTORY_PAGE}`);
  assert.match(historyPath("a/b", "commit", String(Date.parse("2024-01-01T00:00:10Z"))), /until=2024-01-01T00:00:09Z$/);
  const pr = decodeURIComponent(historyPath("a/b", "pr", String(Date.parse("2024-01-01T00:00:00Z"))));
  assert.match(pr, /q=repo:a\/b is:pr created:<2024-01-01T00:00:00Z&sort=created&order=desc/);
  assert.match(historyPath("a/b", "release", "3"), /page=3$/);
  assert.equal(historyTtl("commit", "", NOW), 5 * 60_000);
  assert.equal(historyTtl("commit", String(NOW - 30 * DAY), NOW), 7 * DAY);
  assert.equal(historyTtl("release", "2", NOW), 3600_000);
});

test("历史页: 满一页才给 next, 提交游标取最后一条的提交者时间, PR 合入记 merged (#134)", () => {
  const full = Array.from({ length: GITHUB_HISTORY_PAGE }, (_, i) => commit(`s${i}`, NOW - i * DAY));
  const r = historyOf("a/b", "commit", "", { status: 200, ok: true, body: full, remaining: 1 });
  assert.equal(r.items.length, GITHUB_HISTORY_PAGE);
  assert.equal(r.items[0]?.title, "提交 s0");
  assert.equal(r.items[0]?.by, "hx");
  assert.equal(r.next, String(NOW - (GITHUB_HISTORY_PAGE - 1) * DAY));
  const short = historyOf("a/b", "commit", "", { status: 200, ok: true, body: full.slice(0, 2), remaining: 1 });
  assert.equal(short.next, undefined);
  const prs = historyOf("a/b", "pr", "", { status: 200, ok: true, body: { items: [{ number: 7, title: "修", html_url: "u", created_at: "2020-01-01T00:00:00Z", state: "closed", user: { login: "x" }, pull_request: { merged_at: "2020-01-02T00:00:00Z" } }] }, remaining: 1 });
  assert.deepEqual(prs.items[0], { id: "pr7", ts: Date.parse("2020-01-01T00:00:00Z"), kind: "pr", title: "修", url: "u", number: 7, state: "merged", by: "x" });
  const rel = historyOf("a/b", "release", "2", { status: 200, ok: true, body: Array.from({ length: GITHUB_HISTORY_PAGE }, (_, i) => ({ id: i, tag_name: `v${i}` })), remaining: 1 });
  assert.equal(rel.next, "3");
});

function svcWith(kv: ReturnType<typeof memKv>, sql = memSql()) {
  return new GithubService({ GITHUB_TOKEN: "t" } as never, sql, kv.storage, { sources: () => [] } as never);
}

async function tracked(kv: ReturnType<typeof memKv>, repos: string[]) {
  await kv.storage.put("githubPicks", { picks: repos, hidden: [] });
  await kv.storage.put("githubLogin", "hx");
}

test("服务历史: 只给关注的仓库; 同一页走缓存不重复调 GitHub; 限流报 429 (#134)", async () => {
  const kv = memKv();
  await tracked(kv, ["a/b"]);
  const svc = svcWith(kv);
  const calls = mockGithub((u) => (u.pathname.includes("/x/y/") ? [429, {}] : [200, [commit("s1", NOW)]]));
  await assert.rejects(svc.history("c/d", "commit", "", NOW), (e) => e instanceof HistoryFail && e.status === 404);
  const r = await svc.history("A/B", "commit", "123", NOW);
  assert.equal(r?.items[0]?.id, "s1");
  await svc.history("a/b", "commit", "123", NOW + 1000);
  assert.equal(calls.length, 1);
  await tracked(kv, ["a/b", "x/y"]);
  await assert.rejects(svc.history("x/y", "commit", "", NOW), (e) => e instanceof HistoryFail && e.status === 429);
});

test("回填: 按页拉本人提交按天求和, 预算用完就停, 下次接着拉, 拉完开增量窗口 (#134)", async () => {
  const kv = memKv();
  // 250 个提交, 每天 1 个, 从 2026-11-27 往前
  const all = Array.from({ length: 250 }, (_, i) => commit(`c${i}`, NOW - i * DAY));
  const calls = mockGithub((u) => {
    if (u.pathname.endsWith("/e/f/commits")) return [409, {}];
    const page = Number(u.searchParams.get("page"));
    assert.equal(u.searchParams.get("author"), "hx");
    const since = u.searchParams.get("since");
    if (since) return [200, [commit("new", Date.parse(since) + 1000)]];
    return [200, all.slice((page - 1) * 100, page * 100)];
  });
  const state: HeatState = { ...emptyState(NOW), tz: TZ };
  const years = new HeatYears(kv.storage);
  const base = { token: "t", login: "hx", repos: ["a/b", "e/f"], state, years, tz: TZ, now: NOW };
  assert.equal(await backfillStep({ ...base, budget: 2 }), 2);
  assert.equal(state.repos["a/b"]?.page, 2);
  assert.equal(state.repos["e/f"]?.page, 0, "空仓库 409 直接算拉完");
  assert.deepEqual(backfillOf(state, ["a/b", "e/f"]), { done: false, repos: 2, pending: 1, oldest: "2026-08-20" });
  assert.equal(await backfillStep({ ...base, budget: 10 }), 2);
  assert.equal(state.repos["a/b"]?.page, 0);
  await kv.storage.put(years.changes());
  const y = new HeatYears(kv.storage);
  await y.load([2026, 2026 - 1]);
  assert.equal(y.count("2026-11-27"), 1);
  assert.equal(y.count("2026-03-23"), 1);
  assert.equal(y.count("2026-03-22"), 0);
  assert.deepEqual(state.years.sort(), [2026]);
  assert.equal(backfillOf(state, ["a/b", "e/f"]).done, true);
  // 不到 20 小时不开增量窗口, 不调 GitHub
  const n = calls.length;
  assert.equal(await backfillStep({ ...base, budget: 5, now: NOW + 3600_000 }), 0);
  assert.equal(calls.length, n);
  // 一天后开增量窗口 [上次 until + 1 秒, 现在]
  const later = NOW + DAY;
  assert.equal(await backfillStep({ ...base, budget: 5, now: later }), 2);
  const cur = state.repos["a/b"];
  assert.equal(cur?.page, 0);
  assert.equal(Date.parse(cur?.since ?? ""), Math.floor(NOW / 1000) * 1000 + 1000);
});

test("回填: 额度见底或 429 就停手, 游标不动 (#134)", async () => {
  const kv = memKv();
  mockGithub(() => [429, {}, 0]);
  const state: HeatState = { ...emptyState(NOW), tz: TZ };
  const used = await backfillStep({ token: "t", login: "hx", repos: ["a/b"], state, years: new HeatYears(kv.storage), tz: TZ, budget: 10, now: NOW });
  assert.equal(used, 1);
  assert.equal(state.repos["a/b"]?.page, 1);
  mockGithub(() => [200, Array.from({ length: 100 }, (_, i) => commit(`c${i}`, NOW - i * 3600_000)), 10]);
  assert.equal(await backfillStep({ token: "t", login: "hx", repos: ["a/b"], state, years: new HeatYears(kv.storage), tz: TZ, budget: 10, now: NOW }), 1);
  assert.equal(state.repos["a/b"]?.page, 2);
});

test("服务: cron 刷新时回填并写年份行与状态行; 热力图带进度与年份; 清除时一并删掉 (#134)", async () => {
  const kv = memKv();
  await tracked(kv, ["a/b"]);
  const svc = svcWith(kv);
  mockGithub(() => [200, [commit("old", Date.parse("2019-06-01T12:00:00+08:00")), commit("c1", NOW)]]);
  await svc.refreshHeatmap(TZ, NOW);
  const st = (await kv.storage.get(KV_HEAT_STATE)) as HeatState;
  assert.equal(st.tz, TZ);
  assert.deepEqual([...st.years].sort(), [2019, 2026]);
  const h = await svc.heatmap(TZ, NOW, 2019);
  assert.equal(h.map.days.find((d) => d.date === "2019-06-01")?.commits, 1);
  assert.deepEqual(h.map.years, [2026, 2019]);
  assert.deepEqual(h.map.backfill, { done: true, repos: 1, pending: 0, oldest: "2019-06-01" });
  await svc.purge();
  assert.equal(kv.map.has("githubHeat:2019") || kv.map.has(KV_HEAT_STATE), false);
});
