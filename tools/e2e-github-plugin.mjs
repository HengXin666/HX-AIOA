#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
// GitHub 插件 (hengxin666.github) 端到端: 放行 -> 启用 -> webhook 入库 -> 读接口 -> events:read 的 key 读 -> 停用后全部 404 -> 再启用数据还在 -> purge 清空
// 本机起静态服务充当市场 (仓库 plugins/ 目录), 服务端用 --var PLUGIN_MARKET 指过来
// 环境变量: AIOA_SERVER, AIOA_TOKEN, AIOA_MARKET_PORT (默认 8797)
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const PORT = Number(process.env.AIOA_MARKET_PORT ?? 8797);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
const V1 = "/api/v1";
const ID = "hengxin666.github";
const ALLOW = `${V1}/plugin-allow/${ID}`;
const ENABLED = `${V1}/plugins/${ID}/enabled`;
const REPOS = `${V1}/github/repos`;
const RUN = Date.now().toString(36);
const REPO = `HengXin666/ghp-${RUN}`;
const NOT_FOUND = 404;
let failed = 0;

const market = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url ?? "/")).replace(/^(\.\.[/\\])+/, "");
  try {
    res.end(await readFile(join(ROOT, path), "utf8"));
  } catch {
    res.statusCode = NOT_FOUND;
    res.end("not found");
  }
});
await new Promise((ok) => market.listen(PORT, "127.0.0.1", ok));

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail).slice(0, 400)}`}`);
  if (!ok) failed += 1;
}

async function call(bearer, method, path, body) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}
const api = (m, p, b) => call(token, m, p, b);

const repository = { full_name: REPO, name: REPO.split("/")[1], html_url: `https://github.com/${REPO}` };
const ping = { zen: "hi", hook_id: 1, repository: { ...repository, stargazers_count: 3, open_issues_count: 0, description: "插件 e2e", default_branch: "main" } };
const push = { ref: "refs/heads/main", pusher: { name: "HengXin666" }, commits: [{ id: "c1", message: "插件化" }], repository };
const pr = { action: "opened", number: 1, pull_request: { number: 1, title: "GitHub 插件化", html_url: `https://github.com/${REPO}/pull/1`, user: { login: "HengXin666" }, draft: false, updated_at: new Date().toISOString() }, repository };

async function deliver(url, secret, kind, payload) {
  const raw = JSON.stringify(payload);
  const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-GitHub-Event": kind, "X-Hub-Signature-256": sig }, body: raw });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// 放行: 新部署由升级迁移种子放行并为主人启用; 这里撤销后从市场重新放行, 走一遍正常流程
const seeded = await api("GET", `${V1}/plugin-allow`);
check("升级迁移: 已在白名单", seeded.status === 200 && seeded.data.allow.some((a) => a.id === ID), seeded.data);
await api("DELETE", ALLOW);
check("撤销后接口 404", (await api("GET", REPOS)).status === NOT_FOUND);
const allowed = await api("PUT", ALLOW, {});
check("从市场放行", allowed.status === 200 && allowed.data.allow.version === "1.0.1" && allowed.data.allow.risky?.includes("net:api.github.com"), allowed.data);
check("放行但没启用时接口 404", (await api("GET", REPOS)).status === NOT_FOUND);
const install = await api("POST", `${V1}/plugins/${ID}/install`);
check("没有 Agent 的插件不能安装", install.status === 400, install.data);
const on = await api("PUT", ENABLED);
check("主人启用", on.status === 200 && on.data.enabled.includes(ID), on.data);

// webhook 入库
const src = (await api("POST", `${V1}/sources`, { name: `GitHub ${RUN}`, type: "github", subject: `github:${REPO}`, key: {} })).data;
const hook = server + new URL(src.key.webhookUrls.github).pathname;
const secret = src.key.webhookSecret;
for (const [kind, body] of [["ping", ping], ["push", push], ["pull_request", pr]]) {
  const r = await deliver(hook, secret, kind, body);
  check(`webhook ${kind} 入库`, r.status === 200, r);
}

// 读接口: 主人与 events:read 的 key
const reader = (await api("POST", `${V1}/keys`, { name: `ghp-${RUN}`, scopes: ["events:read"] })).data;
const readKey = reader?.key;
check("建 events:read 的 key", typeof readKey === "string" && readKey.length > 0, reader);
const READS = [REPOS, `${V1}/github/repos/${REPO}`, `${V1}/github/activity`, `${V1}/github/daily?days=7&tz=480`];
const repos = await api("GET", REPOS);
const sum = repos.data?.repos?.find((r) => r.repo === REPO);
check("仓库摘要来自 webhook", repos.status === 200 && sum?.stars === 3 && sum?.openPrs === 1 && sum?.lastPush?.commits === 1, sum ?? repos.data);
for (const p of READS) {
  check(`主人读 ${p}`, (await api("GET", p)).status === 200);
  check(`key 读 ${p}`, (await call(readKey, "GET", p)).status === 200);
}

// 停用 (不清数据): 主人, key, webhook, 写接口全部 404, 事件不入库
const head = (await api("GET", `${V1}/events?limit=1`)).data?.head ?? 0;
const off = await api("DELETE", ENABLED);
check("主人停用", off.status === 200 && !off.data.enabled.includes(ID) && off.data.purged === 0, off.data);
for (const p of READS) {
  check(`停用后主人读 ${p} 404`, (await api("GET", p)).status === NOT_FOUND);
  check(`停用后 key 读 ${p} 404`, (await call(readKey, "GET", p)).status === NOT_FOUND);
}
check("停用后同步 404", (await api("POST", `${V1}/github/sync`)).status === NOT_FOUND);
check("停用后改关注列表 404", (await api("PUT", `${V1}/github/tracked`, { repos: [REPO] })).status === NOT_FOUND);
const dropped = await deliver(hook, secret, "push", { ...push, commits: [{ id: "c2", message: "停用期间" }] });
check("停用后 webhook 404", dropped.status === NOT_FOUND, dropped);
const evs = (await api("GET", `${V1}/events?since=${head}&limit=200`)).data?.events ?? [];
check("停用期间 webhook 不入库", !evs.some((e) => e.source?.id === src.id), evs.length);

// 再启用: 数据还在, 停用期间的推送没进来
await api("PUT", ENABLED);
const back = (await api("GET", REPOS)).data?.repos?.find((r) => r.repo === REPO);
check("再启用后数据还在", back?.stars === 3 && back?.openPrs === 1 && back?.lastPush?.commits === 1, back);
check("再启用后 key 能读", (await call(readKey, "GET", `${V1}/github/repos/${REPO}`)).status === 200);

// 停用并清除: 删掉来源后 purge, 再启用时仓库不在了
await api("DELETE", `${V1}/sources/${src.id}`);
await api("DELETE", `${V1}/keys/${reader.id}`);
const purge = await api("DELETE", `${ENABLED}?purge=1`);
check("停用并清除 GitHub 数据", purge.status === 200 && purge.data.purged > 0, purge.data);
await api("PUT", ENABLED);
const after = await api("GET", REPOS);
check("清除后仓库不在了", after.status === 200 && !after.data.repos.some((r) => r.repo === REPO), after.data);

market.close();
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
