import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { memSql } from "./sql";

const { GITHUB_PLUGIN, dailyRequests, parseManifest } = await import("@hx-aioa/protocol");
const { AllowStore } = await import("../src/plugins/allow-store");
const { PluginKernel } = await import("../src/plugins/kernel");
const { seedBuiltins, builtinRow } = await import("../src/plugins/builtins");
const { gated, githubOn } = await import("../src/github/gate");
const { GithubStore } = await import("../src/github/store");
const { ActivityStore } = await import("../src/github/activity");

const OWNER = "u-owner";
const raw = JSON.parse(readFileSync(new URL("../../plugins/hengxin666.github/plugin.json", import.meta.url), "utf8"));

function kernel(sql = memSql()) {
  const allow = new AllowStore(sql);
  return { sql, allow, k: new PluginKernel(allow, undefined, () => seedBuiltins(allow, OWNER, 1)) };
}

test("清单: api 2 可以不要 Agent, api 1 仍必须有; 预算按 cron 48 次加自报", () => {
  const m = parseManifest(raw);
  assert.equal(typeof m, "object");
  if (typeof m === "string") return;
  assert.equal(m.agent, undefined);
  assert.equal(dailyRequests(m), 48 + (m.budget?.requestsPerDay ?? 0));
  const { api: _a, engines: _e, permissions: _p, contributes: _c, budget: _b, ...legacy } = raw;
  assert.match(String(parseManifest(legacy)), /agent\.name/);
  assert.match(String(parseManifest({ ...raw, agent: { name: "" } })), /agent\.name/);
  assert.deepEqual(builtinRow(raw, 1).meta.risky, ["net:api.github.com"]);
});

test("升级迁移: 现有部署视为已放行并为主人启用, 只跑一次", () => {
  const { sql, k } = kernel();
  assert.ok(k.isEnabled(OWNER, GITHUB_PLUGIN));
  assert.equal(k.get(GITHUB_PLUGIN)?.meta.by, "升级迁移");
  k.setEnabled(OWNER, GITHUB_PLUGIN, false);
  assert.ok(!kernel(sql).k.isEnabled(OWNER, GITHUB_PLUGIN), "停用后重启不被改回");
  k.revoke(GITHUB_PLUGIN);
  assert.equal(kernel(sql).k.get(GITHUB_PLUGIN), undefined, "撤销后不再补回");
});

test("升级迁移: 旧插件种子照常跑, 已放行的不被覆盖", () => {
  const sql = memSql();
  const allow = new AllowStore(sql);
  const legacy = { ...builtinRow({ ...raw, id: "todo", api: undefined, engines: undefined, permissions: undefined, contributes: undefined, budget: undefined, server: undefined, agent: { name: "a" } }, 1) };
  const k = new PluginKernel(allow, () => ({ rows: [legacy], uid: OWNER }), () => seedBuiltins(allow, OWNER, 1));
  assert.deepEqual(k.enabledOf(OWNER).sort(), [GITHUB_PLUGIN, "todo"].sort());

  const sql2 = memSql();
  const a2 = new AllowStore(sql2);
  a2.putAllow({ ...builtinRow(raw, 1), meta: { ...builtinRow(raw, 1).meta, by: "管理员" } });
  a2.markSeeded();
  const k2 = new PluginKernel(a2, undefined, () => seedBuiltins(a2, OWNER, 1));
  assert.equal(k2.get(GITHUB_PLUGIN)?.meta.by, "管理员");
  assert.ok(!k2.isEnabled(OWNER, GITHUB_PLUGIN));
});

test("门控: 主人停用后接口 404, 启用后照常", async () => {
  const { k } = kernel();
  const core = { kernel: k, users: { ownerId: () => OWNER } } as never;
  const h = gated(() => new Response("ok"));
  const call = () => h({ core, req: new Request("http://x/", { method: "PUT", body: "{}" }) } as never);
  assert.ok(githubOn(core));
  assert.equal((await call()).status, 200);
  k.setEnabled(OWNER, GITHUB_PLUGIN, false);
  assert.ok(!githubOn(core));
  assert.equal((await call()).status, 404);
  k.setEnabled("u-other", GITHUB_PLUGIN, true);
  assert.ok(!githubOn(core), "只看主人的启用状态");
});

test("清除数据: 清空全部 GitHub 表", () => {
  const sql = memSql();
  const s = new GithubStore(sql);
  const a = new ActivityStore(sql);
  s.saveMeta({ repo: "o/r", url: "u", stars: 1, openIssues: 0, updatedAt: 1 });
  a.add([{ id: "e1", ts: Date.now(), kind: "push", repo: "o/r", title: "t" }]);
  assert.equal(s.clear() + a.clear(), 2);
  assert.deepEqual(s.metas(), []);
});
