#!/usr/bin/env node
import { createHmac } from "node:crypto";
// GitHub 接入端到端测试: 创建 github 来源, 用 webhookSecret 签名发 ping 与 push, 确认事件入库, 再确认错误签名被拒。
// 环境变量: AIOA_SERVER (如 http://127.0.0.1:8787), AIOA_TOKEN (AUTH_TOKEN)
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const POST = "POST";
const ADAPTER = "github";
const RUN = Date.now().toString(36);
const REPO = `HengXin666/e2e-${RUN}`;
const REPO_NAME = REPO.split("/")[1];
const CONNECTED = "GitHub Webhook 已连接";
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failed += 1;
}

async function api(method, path, body) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// GitHub 页面接口: webhook 入库后仓库摘要与详情应同步更新
async function githubPage() {
  for (const [kind, payload] of [["pull_request", prPayload("opened")], ["issues", issuePayload], ["workflow_run", runPayload]]) {
    const r = await deliver(url, kind, payload, secret);
    check(`${kind} 签名通过`, r.status === 200, JSON.stringify(r));
  }
  const repos = await api("GET", `${V1}/github/repos`);
  const sum = repos.data?.repos?.find((x) => x.repo === REPO);
  check("GET github/repos 包含仓库", repos.status === 200 && Boolean(sum) && typeof repos.data?.synced === "boolean", JSON.stringify(repos.data));
  check("摘要: stars, 描述, 默认分支来自 ping", sum?.stars === 5 && sum?.description === "端到端测试仓库" && sum?.defaultBranch === "main", JSON.stringify(sum));
  check("摘要: openPrs=1, openIssues=1", sum?.openPrs === 1 && sum?.openIssues === 1, JSON.stringify(sum));
  check("摘要: lastPush", sum?.lastPush?.branch === "main" && sum?.lastPush?.commits === 2 && sum?.lastPush?.by === "HengXin666", JSON.stringify(sum?.lastPush));
  check("摘要: ci 失败", sum?.ci?.status === "failure" && sum?.ci?.workflow === WORKFLOW, JSON.stringify(sum?.ci));
  const detail = await api("GET", `${V1}/github/repos/${REPO}`);
  const d = detail.data;
  check("GET 详情 200", detail.status === 200, JSON.stringify(d));
  check("详情: PR 列表", d?.prs?.length === 1 && d.prs[0].number === PR_NUMBER && d.prs[0].author === "HengXin666" && d.prs[0].draft === false, JSON.stringify(d?.prs));
  check("详情: Issue 列表带标签", d?.issues?.length === 1 && d.issues[0].number === ISSUE_NUMBER && d.issues[0].labels?.[0] === "bug", JSON.stringify(d?.issues));
  check("详情: runs", d?.runs?.length === 1 && d.runs[0].status === "failure" && d.runs[0].branch === "main", JSON.stringify(d?.runs));
  const kinds = (d?.timeline ?? []).map((x) => x.kind);
  check("详情: timeline 含 push/pr/issue/ci", ["push", "pr", "issue", "ci"].every((k) => kinds.includes(k)), JSON.stringify(kinds));
  check("详情: 时间字段为毫秒", typeof d?.repo?.updatedAt === "number" && d.repo.updatedAt > 1e12, String(d?.repo?.updatedAt));

  const closed = await deliver(url, "pull_request", prPayload("closed", { merged: true }), secret);
  check("PR closed 签名通过", closed.status === 200, JSON.stringify(closed));
  const after = (await api("GET", `${V1}/github/repos/${REPO}`)).data;
  check("PR 关闭后从列表消失", after?.prs?.length === 0 && after?.repo?.openPrs === 0, JSON.stringify(after?.prs));
  check("timeline 记录合并", (after?.timeline ?? []).some((x) => x.kind === "pr" && /已合并/.test(x.title)), JSON.stringify(after?.timeline?.[0]));
  const missing = await api("GET", `${V1}/github/repos/nobody/none-${RUN}`);
  check("未知仓库 404", missing.status === 404, String(missing.status));
  const sync = await api(POST, `${V1}/github/sync`);
  check("sync: 无 token 返回 400, 有 token 返回结果", sync.status === 400 ? sync.data?.error === "服务端没有配置 GITHUB_TOKEN" : sync.status === 200 && typeof sync.data?.repos === "number", JSON.stringify(sync));
}

// 与 GitHub 相同: 对原始请求体做 HMAC-SHA256
function sign(secret, raw) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

async function deliver(url, kind, payload, secret) {
  const raw = JSON.stringify(payload);
  const res = await fetch(url, {
    method: POST,
    headers: { "Content-Type": "application/json", "X-GitHub-Event": kind, "X-GitHub-Delivery": `${RUN}-${kind}`, "X-Hub-Signature-256": sign(secret, raw) },
    body: raw,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const repository = { full_name: REPO, name: REPO_NAME, html_url: `https://github.com/${REPO}` };
const pingRepo = { ...repository, stargazers_count: 5, open_issues_count: 0, description: "端到端测试仓库", default_branch: "main" };
const ping = { zen: "Keep it logically awesome.", hook_id: 1, hook: { type: "Repository", events: ["push"] }, repository: pingRepo };
const push = {
  ref: "refs/heads/main",
  compare: `https://github.com/${REPO}/compare/a...b`,
  pusher: { name: "HengXin666" },
  commits: [{ id: "b1", message: "修复登录超时\n\n详细说明" }, { id: "b2", message: "补充测试" }],
  repository,
};

const PR_NUMBER = 7;
const ISSUE_NUMBER = 3;
const WORKFLOW = "CI";
const user = { login: "HengXin666" };
const prPayload = (action, extra = {}) => ({
  action,
  number: PR_NUMBER,
  pull_request: { number: PR_NUMBER, title: "新增 GitHub 页面", html_url: `https://github.com/${REPO}/pull/${PR_NUMBER}`, user, draft: false, updated_at: new Date().toISOString(), ...extra },
  repository,
});
const issuePayload = { action: "opened", issue: { number: ISSUE_NUMBER, title: "安卓端闪退", html_url: `https://github.com/${REPO}/issues/${ISSUE_NUMBER}`, user, labels: [{ name: "bug" }], updated_at: new Date().toISOString() }, repository };
const runPayload = {
  action: "completed",
  workflow_run: { id: 9001, name: WORKFLOW, head_branch: "main", status: "completed", conclusion: "failure", html_url: `https://github.com/${REPO}/actions/runs/9001`, updated_at: new Date().toISOString() },
  repository,
};

const head = (await api("GET", `${V1}/events?limit=1`)).data?.head ?? 0;
const created = await api(POST, `${V1}/sources`, { name: `GitHub ${REPO_NAME}`, type: ADAPTER, subject: `github:${REPO}`, key: {} });
const src = created.data;
check("创建 github 来源", created.status === 200 && src?.key?.webhookUrls?.[ADAPTER], JSON.stringify(created.data));
const given = src.key.webhookUrls[ADAPTER];
// wrangler dev 会把 origin 换成 wrangler.toml 里 routes 的域名, 本地测试只取路径
const url = server + new URL(given).pathname;
const secret = src.key.webhookSecret;
console.log(`  Payload URL: ${given}`);
check("返回 webhookSecret (服务端已配 TOKEN_SECRET)", Boolean(secret), "secret 为空");
check("Payload URL 指向 hooks/github/{keyId}", given.endsWith(`${V1}/hooks/${ADAPTER}/${src.keyId}`), given);

const r1 = await deliver(url, "ping", ping, secret);
check("ping 签名通过", r1.status === 200 && r1.data?.results?.length === 1, JSON.stringify(r1));
const r2 = await deliver(url, "push", push, secret);
check("push 签名通过", r2.status === 200 && r2.data?.results?.length === 1, JSON.stringify(r2));

const list = (await api("GET", `${V1}/events?since=${head}&limit=200`)).data?.events ?? [];
const mine = list.filter((e) => e.source?.id === src.id);
for (const e of mine) console.log(`  收到: ${e.data?.title} | subject=${e.subject} | 路由=${e.route?.action}`);
check("事件来源是新建的来源", mine.length === 2, `实际 ${mine.length} 条`);
check("ping 生成 已连接 事件", mine.some((e) => e.data?.title === `[${REPO_NAME}] ${CONNECTED}`));
check("push 生成推送事件并带提交摘要", mine.some((e) => /推送 2 个提交到 main/.test(e.data?.title ?? "") && /修复登录超时/.test(e.data?.summary ?? "")));
check("事件 subject 为 github:owner/repo", mine.length > 0 && mine.every((e) => e.subject === `github:${REPO}`));

await githubPage();

const bad = await deliver(url, "push", push, "wrong-secret");
check("错误签名被拒 (401)", bad.status === 401, JSON.stringify(bad));
const unsigned = await fetch(url, { method: POST, headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" }, body: JSON.stringify(push) });
check("无签名无 key 被拒 (401)", unsigned.status === 401, String(unsigned.status));

const del = await api("DELETE", `${V1}/sources/${src.id}`);
check("删除来源", del.status === 200, JSON.stringify(del.data));
const after = await deliver(url, "ping", ping, secret);
check("删除来源后 webhook 失效", after.status === 401, JSON.stringify(after));

console.log(failed ? `共 ${failed} 项失败` : "全部通过");
process.exit(failed ? 1 : 0);
