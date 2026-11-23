#!/usr/bin/env node
// 邮件聚合冒烟测试: 通用推送, HX-Email Webhook, 去重, 按时间 / 厂商 / 账号筛选, 统计, 邮件群资料
// 本地 wrangler dev 还会试 /cdn-cgi/handler/email (CF 邮件路由入口), 不支持时跳过
// 环境变量: AIOA_SERVER, AIOA_TOKEN
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const UA = "hx-aioa-e2e/1";
const RUN = Date.now().toString(36);
const ACC_A = `a-${RUN}@gmail.com`;
const ACC_B = `b-${RUN}@outlook.com`;
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail).slice(0, 400)}`}`);
  if (!ok) failed += 1;
}

async function call(method, path, body) {
  const res = await fetch(server + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "user-agent": UA, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}

const t0 = Date.now() - 60_000;
const gh = await call("POST", `${V1}/mail`, { from: "noreply@github.com", name: "GitHub", to: ACC_A, subject: `PR 合并 ${RUN}`, text: "your PR was merged", messageId: `<gh-${RUN}@github.com>`, ts: t0 });
check("通用推送", gh.status === 200 && gh.data.channel === "mail", gh);
const again = await call("POST", `${V1}/mail`, { from: "noreply@github.com", to: ACC_A, subject: `PR 合并 ${RUN}`, text: "again", messageId: `<gh-${RUN}@github.com>`, ts: t0 });
check("同一 Message-ID 只覆盖", again.data.id === gh.data.id, again);

const hx = {
  event: "new_mail",
  message_id: `${RUN}-1`,
  user_id: 1,
  usable_email: { id: 7, address: ACC_B, group_id: 3, group_name: "registrations" },
  message: { from: "noreply@tm.openai.com", to: ACC_B, subject: "Your ChatGPT code", body: "Code: 482913", received_at: "x", verification_code: "482913" },
};
const h = await call("POST", `${V1}/mail/hx-email`, hx);
check("HX-Email Webhook", h.status === 200 && h.data.channel === "mail", h);
check("HX-Email 测试事件", (await call("POST", `${V1}/mail/hx-email`, { event: "test" })).status === 200);
check("坏请求 400", (await call("POST", `${V1}/mail`, { from: "x@y.z" })).status === 400);

const all = await call("GET", `${V1}/mail?limit=2`);
const first = all.data.messages?.[0];
check("最新在前", first?.data?.mail?.vendor === "GPT" && first.data.mail.code === "482913", all.data);
check("验证码的信优先级 need_me", first?.priority === "need_me", first);
const byVendor = await call("GET", `${V1}/mail?vendor=GitHub`);
check("按厂商筛选", byVendor.data.messages.length > 0 && byVendor.data.messages.every((m) => m.data.mail.vendor === "GitHub"), byVendor.data);
const byAcc = await call("GET", `${V1}/mail?account=${encodeURIComponent(ACC_A)}`);
check("按账号筛选", byAcc.data.messages.length === 1 && byAcc.data.messages[0].data.summary === "again", byAcc.data);
const older = await call("GET", `${V1}/mail?before=${first.ts}&limit=200`);
check("翻页 before", older.data.messages.every((m) => m.ts < first.ts), older.data);

const f = await call("GET", `${V1}/mail/facets`);
const accB = f.data.accounts?.find((x) => x.key === ACC_B);
check("统计: 厂商与账号", f.data.vendors?.some((x) => x.key === "GPT") && accB?.count === 1, f.data);
const chats = await call("GET", `${V1}/chats`);
const list = Array.isArray(chats.data) ? chats.data : chats.data.chats ?? [];
const mailChat = list.find((c) => c.channel === "mail");
check("邮件群: 标题与视图", mailChat?.title === "邮件" && mailChat?.view === "mail", mailChat);

// 删掉一封后不再出现在列表和统计里
const del = await call("DELETE", `${V1}/events/seq/${first.seq}`);
if (del.status < 300) {
  const after = await call("GET", `${V1}/mail?account=${encodeURIComponent(ACC_B)}`);
  check("删除后列表不再有", after.data.messages.length === 0, after.data);
} else console.log(`跳过 删除 (${del.status})`);

const eml = [`From: Cloudflare <noreply@notify.cloudflare.com>`, `To: ${ACC_A}`, `Subject: cf ${RUN}`, `Message-ID: <cf-${RUN}@cf>`, "Content-Type: text/plain", "", "hello from email routing", ""].join("\r\n");
const r = await fetch(`${server}/cdn-cgi/handler/email?from=noreply%40notify.cloudflare.com&to=${encodeURIComponent(ACC_A)}`, { method: "POST", body: eml, headers: { "user-agent": UA } }).catch(() => null);
if (r && r.status < 300) {
  const cf = await call("GET", `${V1}/mail?vendor=Cloudflare`);
  check("CF 邮件路由入口", cf.data.messages.some((m) => m.data.title === `cf ${RUN}` && m.data.mail.via === "cf"), cf.data);
} else console.log(`跳过 CF 邮件路由入口 (${r?.status ?? "连不上"})`);

console.log(failed ? `失败 ${failed} 项` : "全部通过");
process.exit(failed ? 1 : 0);
