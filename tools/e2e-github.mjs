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
const ping = { zen: "Keep it logically awesome.", hook_id: 1, hook: { type: "Repository", events: ["push"] }, repository };
const push = {
  ref: "refs/heads/main",
  compare: `https://github.com/${REPO}/compare/a...b`,
  pusher: { name: "HengXin666" },
  commits: [{ id: "b1", message: "修复登录超时\n\n详细说明" }, { id: "b2", message: "补充测试" }],
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
