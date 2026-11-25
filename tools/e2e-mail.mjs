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
check("统计: 分类", f.data.categories?.some((x) => x.key === "AI") && f.data.categories?.some((x) => x.key === "开发"), f.data);
const byCat = await call("GET", `${V1}/mail?category=${encodeURIComponent("开发")}`);
// 旧库升级时只补索引的分类, 所以只看本轮的信
const mine = byCat.data.messages.filter((m) => m.data.title.includes(RUN));
check("按分类筛选", mine.length > 0 && mine.every((m) => m.data.mail.category === "开发") && byCat.data.messages.every((m) => m.data.mail.vendor !== "GPT"), byCat.data);
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

// 正文: HTML 原文与长文本单独取, 列表不带 HTML
const html = `<div><h1>欢迎 ${RUN}</h1><p>${"x".repeat(2000)}</p></div>`;
const hm = await call("POST", `${V1}/mail`, { from: "hi@vercel.com", to: ACC_A, subject: `HTML 信 ${RUN}`, html });
const hl = await call("GET", `${V1}/mail?vendor=Vercel`);
const hev = hl.data.messages?.find((m) => m.id === hm.data.id);
check("列表不带 HTML, 标记有原文", hev && hev.data.html === undefined && hev.data.mail.body === "html", hev);
const hb = await call("GET", `${V1}/mail/${hm.data.id}/body`);
check("取 HTML 原文", hb.status === 200 && hb.data.html === html, hb.status);
const long = `第一行 <b>\n${"长文本 ".repeat(200)}`;
const tm = await call("POST", `${V1}/mail`, { from: "news@notion.so", to: ACC_A, subject: `长文 ${RUN}`, text: long });
const tb = await call("GET", `${V1}/mail/${tm.data.id}/body`);
check("长文本转成 HTML", tb.status === 200 && tb.data.html.startsWith("<pre") && tb.data.html.includes("&lt;b&gt;"), tb.data);
check("短信没有正文接口", (await call("GET", `${V1}/mail/${gh.data.id}/body`)).status === 404);
const found = await call("GET", `${V1}/mail?q=${encodeURIComponent(`长文 ${RUN}`)}`);
check("关键词搜主题", found.data.messages?.length === 1 && found.data.messages[0].id === tm.data.id, found.data);
const byFrom = await call("GET", `${V1}/mail?q=${encodeURIComponent("vercel.com")}`);
check("关键词搜发件人", byFrom.data.messages?.some((m) => m.id === hm.data.id), byFrom.data);
check("关键词里的 % 不当通配", (await call("GET", `${V1}/mail?q=%25`)).data.messages?.length === 0);

// 显示偏好, 转发, 自动转发规则
const FWD = `mailfwd-${RUN}`;
await call("PATCH", `${V1}/chats/${encodeURIComponent(FWD)}`, { title: "邮件转发测试" });
const p0 = await call("GET", `${V1}/mail/prefs`);
check("偏好默认只放行白名单", p0.status === 200 && p0.data.images === "known", p0.data);
const p1 = await call("PUT", `${V1}/mail/prefs`, { images: "known", senders: { "Devpost.com": { images: "show" } } });
check("偏好保存", p1.status === 200 && p1.data.senders["devpost.com"]?.images === "show" && (await call("GET", `${V1}/mail/prefs`)).data.senders["devpost.com"]?.images === "show", p1.data);
check("偏好校验", (await call("PUT", `${V1}/mail/prefs`, { images: "maybe" })).status === 400);
const fw = await call("POST", `${V1}/mail/${hm.data.id}/forward`, { channel: FWD });
const fmsgs = (await call("GET", `${V1}/chats/${encodeURIComponent(FWD)}/messages?since=0`)).data.messages ?? [];
const fm = fmsgs.find((m) => m.id === fw.data.id);
check("手动转进群", fw.status === 200 && fm && fm.source.type === "user" && fm.data.summary?.includes(`HTML 信 ${RUN}`) && fm.data.summary?.includes("hi@vercel.com") && fm.data.file && fm.fwd?.channel === "mail", fm ?? fw.data);
check("转到不存在的群 404", (await call("POST", `${V1}/mail/${hm.data.id}/forward`, { channel: `nope-${RUN}` })).status === 404);
const rr = await call("PUT", `${V1}/mail/rules`, { rules: [{ channel: FWD, domain: "sentry.io", subject: `告警 ${RUN}`, keep: false }] });
check("规则保存", rr.status === 200 && rr.data.rules.length === 1 && rr.data.rules[0].keep === false, rr.data);
const al = await call("POST", `${V1}/mail`, { from: "noreply@sentry.io", to: ACC_A, subject: `告警 ${RUN} 新错误`, text: "TypeError at line 3", messageId: `<s-${RUN}@sentry>` });
await call("POST", `${V1}/mail`, { from: "noreply@sentry.io", to: ACC_A, subject: `周报 ${RUN}`, text: "weekly", messageId: `<w-${RUN}@sentry>` });
const after = (await call("GET", `${V1}/chats/${encodeURIComponent(FWD)}/messages?since=0`)).data.messages ?? [];
check("规则自动转发, 不命中的不转", after.filter((m) => m.data?.summary?.includes("TypeError")).length === 1 && !after.some((m) => m.data?.summary?.includes(`周报 ${RUN}`)), after.map((m) => m.data?.summary?.slice(0, 40)));
const kept = await call("GET", `${V1}/mail?q=${encodeURIComponent(`告警 ${RUN}`)}`);
check("keep=false 转完从邮件列表删掉", kept.data.messages?.length === 0 && al.status === 200, kept.data);
await call("POST", `${V1}/mail`, { from: "noreply@sentry.io", to: ACC_A, subject: `告警 ${RUN} 新错误`, text: "TypeError at line 3", messageId: `<s-${RUN}@sentry>` });
const again2 = (await call("GET", `${V1}/chats/${encodeURIComponent(FWD)}/messages?since=0`)).data.messages ?? [];
check("同一封重投不重复转", again2.filter((m) => m.data?.summary?.includes("TypeError")).length === 1);
await call("PUT", `${V1}/mail/rules`, { rules: [] });

const eml = [`From: Cloudflare <noreply@notify.cloudflare.com>`, `To: ${ACC_A}`, `Subject: cf ${RUN}`, `Message-ID: <cf-${RUN}@cf>`, "Content-Type: text/plain", "", "hello from email routing", ""].join("\r\n");
const r = await fetch(`${server}/cdn-cgi/handler/email?from=noreply%40notify.cloudflare.com&to=${encodeURIComponent(ACC_A)}`, { method: "POST", body: eml, headers: { "user-agent": UA } }).catch(() => null);
if (r && r.status < 300) {
  const cf = await call("GET", `${V1}/mail?vendor=Cloudflare`);
  check("CF 邮件路由入口", cf.data.messages.some((m) => m.data.title === `cf ${RUN}` && m.data.mail.via === "cf"), cf.data);
} else console.log(`跳过 CF 邮件路由入口 (${r?.status ?? "连不上"})`);

console.log(failed ? `失败 ${failed} 项` : "全部通过");
process.exit(failed ? 1 : 0);
