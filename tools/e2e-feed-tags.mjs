#!/usr/bin/env node
// 信息流标签冒烟测试: 群主改标签表, 专属指令带标签定义, 未声明标签被拒, Agent 带 rev 追加。
// 环境变量: AIOA_SERVER, AIOA_TOKEN (AUTH_TOKEN)
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const GROUP = `tags-${Date.now().toString(36)}`;
const TAGS_PATH = `${V1}/chat-agent/feed-tags`;
const enc = encodeURIComponent;
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failed += 1;
}

async function api(method, path, body, auth = token) {
  const res = await fetch(server + path, { method, headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { view: "feed" });
const made = await api("POST", `${V1}/chats/${enc(GROUP)}/agents`, { name: "采集", reads: [GROUP] });
const key = made.data?.key;
check("接入 Agent", made.status === 200 && !!key, made);
async function guide() {
  const res = await fetch(`${server}${V1}/chat-agent/guide`, { headers: { Authorization: `Bearer ${key}` } });
  return { text: await res.text(), version: res.headers.get("X-Aioa-Guide-Version") };
}
const g0 = await guide();
check("默认标签写进指令", g0?.text?.includes("`deal` 福利:") && g0.text.includes("取排在前面"), g0?.text?.slice(-800));

const t0 = await api("GET", TAGS_PATH, undefined, key);
check("Agent 看到默认表 rev 0", t0.data?.rev === 0 && t0.data.tags.length === 4, t0.data);

const tags = [{ id: "ai", label: "AI", desc: "模型, 额度, AI 工具", color: "purple" }, { id: "deal", label: "福利", desc: "其它能领的", color: "orange" }];
const bad = await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { feedTags: [{ id: "ai", label: "AI" }] });
check("缺定义被拒", bad.status === 400 && /desc/.test(bad.data?.error?.message ?? JSON.stringify(bad.data)), bad.data);
const set = await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { feedTags: tags });
check("群主改标签表, rev 加一", set.status === 200 && set.data.chat.feedRev === 1 && set.data.chat.feedTags.length === 2, set.data);
const g1 = await guide();
check("指令跟着变", g1.version !== g0.version && g1.text.includes("`ai` AI: 模型") && !g1.text.includes("`oss`"), g1.version);

const post = (kind) => api("POST", `${V1}/messages`, { channel: GROUP, feed: { source: "测试", items: [{ title: "x", kind }] } }, key);
const rej = await post("news");
check("未声明标签被拒并列出可用", rej.status === 400 && JSON.stringify(rej.data).includes("ai (AI)"), rej);
check("声明过的标签可发", (await post("ai")).status === 200);
const html = await api("POST", `${V1}/messages`, { channel: GROUP, title: "快报", text: "摘要", html: "<div>x</div>" }, key);
check("信息流群 Agent 发 HTML 被拒并给出 feed 写法", html.status === 422 && JSON.stringify(html.data).includes("feed_required"), html);
check("信息流群普通文字照常", (await api("POST", `${V1}/messages`, { channel: GROUP, text: "采集 已接入" }, key)).status === 200);

const tag = { id: "oss", label: "开源", desc: "开源项目和工具" };
const stale = await api("POST", TAGS_PATH, { rev: 0, tag }, key);
check("rev 过期被拒", stale.status === 409, stale.data);
const dup = await api("POST", TAGS_PATH, { rev: 1, tag: { id: "ai", label: "智能", desc: "x" } }, key);
check("重复标签被拒", dup.status === 409, dup.data);
const add = await api("POST", TAGS_PATH, { rev: 1, tag }, key);
check("带 rev 追加成功", add.status === 200 && add.data.rev === 2 && add.data.tags.at(-1).id === "oss", add.data);
check("追加后可发", (await post("oss")).status === 200);
const reset = await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { feedTags: null });
check("恢复默认", reset.status === 200 && !reset.data.chat.feedTags && reset.data.chat.feedRev === 3, reset.data);

await api("DELETE", `${V1}/chats/${enc(GROUP)}`);
console.log(failed ? `${failed} 项失败` : "全部通过");
process.exit(failed ? 1 : 0);
