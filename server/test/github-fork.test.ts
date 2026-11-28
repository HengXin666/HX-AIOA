import assert from "node:assert/strict";
import { test } from "node:test";
import { applyGithubEvent } from "../src/github/apply";
import { forkOf } from "../src/github/map";
import { GithubStore, emptyMeta } from "../src/github/store";
import { setFork } from "../src/github/sync";
import { footprintOf } from "../src/github/trend";
import { parseTrend } from "../src/github/trend-fetch";
import { memSql } from "./sql";

const NOW = Date.parse("2026-11-28T05:00:00Z");

test("fork 解析: REST 与 GraphQL 两种写法, 自建的不带字段 (#144)", () => {
  assert.deepEqual(forkOf({ fork: true, parent: { full_name: "pingdotgg/t3code" } }), { fork: true, parent: "pingdotgg/t3code" });
  assert.deepEqual(forkOf({ isFork: true, parent: { nameWithOwner: "qybaihe/botark" } }), { fork: true, parent: "qybaihe/botark" });
  // 列表接口的 fork 不带 parent, 只标 fork
  assert.deepEqual(forkOf({ fork: true }), { fork: true });
  assert.deepEqual(forkOf({ fork: false, parent: { full_name: "x/y" } }), {});
  assert.deepEqual(forkOf({ isFork: false }), {});
  assert.deepEqual(forkOf({}), {});
});

test("新建仓库足迹: 账号仓库列表含私有, fork 带上游 (#144)", () => {
  const page = parseTrend({
    viewer: {
      created: {
        nodes: [
          { nameWithOwner: "me/t3code", url: "u1", description: "", isPrivate: false, isFork: true, createdAt: "2026-11-26T06:32:50Z", parent: { nameWithOwner: "pingdotgg/t3code" } },
          { nameWithOwner: "me/secret", url: "u2", description: "私", isPrivate: true, isFork: false, createdAt: "2026-11-26T03:00:00Z", parent: null },
        ],
      },
    },
    search: { nodes: [] },
  }, true);
  const repos = page.rows.filter((r) => r.kind === "repo").map(footprintOf);
  assert.deepEqual(repos[0], { repo: "me/t3code", url: "u1", at: Date.parse("2026-11-26T06:32:50Z"), fork: true, parent: "pingdotgg/t3code" });
  assert.deepEqual(repos[1], { repo: "me/secret", url: "u2", at: Date.parse("2026-11-26T03:00:00Z"), description: "私", private: true });
});

test("仓库列表 fork 标识: 同步按 GitHub 覆盖, webhook 只改布尔值不丢上游 (#144)", () => {
  const store = new GithubStore(memSql());
  const meta = emptyMeta("me/t3code", NOW);
  setFork(meta, forkOf({ fork: true, parent: { full_name: "pingdotgg/t3code" } }));
  store.saveMeta(meta);
  const s = store.summary(store.meta("me/t3code")!);
  assert.equal(s.fork, true);
  assert.equal(s.parent, "pingdotgg/t3code");
  applyGithubEvent(store, "star", { action: "created", repository: { full_name: "me/t3code", fork: true, stargazers_count: 2 } }, NOW);
  assert.equal(store.summary(store.meta("me/t3code")!).parent, "pingdotgg/t3code");
  // 脱离 fork 网络后 GitHub 报 fork=false, 标识跟着去掉
  applyGithubEvent(store, "star", { action: "created", repository: { full_name: "me/t3code", fork: false } }, NOW);
  const after = store.summary(store.meta("me/t3code")!);
  assert.equal("fork" in after, false);
  assert.equal("parent" in after, false);
  const own = emptyMeta("me/own", NOW);
  setFork(own, forkOf({ fork: false }));
  assert.equal("fork" in store.summary(own), false);
});
