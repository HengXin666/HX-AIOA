#!/usr/bin/env node
// 插件冒烟测试: 本机起一个静态服务充当市场 (仓库 plugins/ 目录), 服务端用 --var PLUGIN_MARKET 指过来
// 列表 -> 详情 -> 未放行装不了 -> 管理员放行 -> 安装 (群, Agent, 工作台) -> 放行新版才更新 -> Agent 拉指令, 写待办 -> 卸载 -> 撤销放行
// 环境变量: AIOA_SERVER, AIOA_TOKEN, AIOA_MARKET_PORT (默认 8797)
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const PORT = Number(process.env.AIOA_MARKET_PORT ?? 8797);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
const V1 = "/api/v1";
const ID = "todo";
const CHANNEL = `plugin-${ID}`;
const TODOS = `${V1}/chats/${CHANNEL}/todos`;
const UA = "hx-aioa-agent/1";
// 每次跑用新的待办 id, 卸载会保留数据, 重跑不受上次影响
const T1 = `t-${Date.now().toString(36)}`;
let failed = 0;
// 模拟市场发新版: 设了就改写版本号, 并在提示词末尾加标记
let bumped = null;
const BUMP_MARK = "<!-- e2e 新版 -->";

const market = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url ?? "/")).replace(/^(\.\.[/\\])+/, "");
  try {
    let text = await readFile(join(ROOT, path), "utf8");
    if (bumped && path.endsWith(".json")) text = text.replace(/"version": "[^"]+"/g, `"version": "${bumped}"`);
    if (bumped && path.endsWith("prompt.md")) text += `\n${BUMP_MARK} ${bumped}\n`;
    res.end(text);
  } catch {
    res.statusCode = 404;
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
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", "User-Agent": UA },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
const api = (m, p, b) => call(token, m, p, b);

const ALLOW = `${V1}/plugin-allow/${ID}`;
// 上次跑到一半留下的安装与放行先清掉
await api("DELETE", `${V1}/plugins/${ID}`);
await api("DELETE", ALLOW);

const list = await api("GET", `${V1}/plugins`);
const entry = list.data?.plugins?.find((p) => p.id === ID);
check("市场列表", list.status === 200 && !!entry && !entry.installed && !list.data.error, list.data);
const detail = await api("GET", `${V1}/plugins/${ID}`);
check("插件详情带介绍", detail.status === 200 && detail.data.readmeType === "markdown" && detail.data.readme.includes("点子待办"), detail.data);
check("未安装也能预览任务提示词", typeof detail.data.task === "string" && detail.data.task.includes("plugin-todo") && detail.data.task.includes("### 待办") && !detail.data.task.includes("{{"), detail.data.task);
check("市场索引与清单版本一致", entry?.version === detail.data.manifest?.version, [entry?.version, detail.data.manifest?.version]);
const missing = await api("POST", `${V1}/plugins/nope/install`);
check("市场里没有的插件装不了", missing.status === 403 || missing.status === 404, missing.data);

const notYet = await api("POST", `${V1}/plugins/${ID}/install`);
check("没放行装不了", notYet.status === 403 && notYet.data.code === "plugin_not_allowed", notYet.data);
const allow = await api("PUT", ALLOW, {});
check("管理员放行市场当前版本", allow.status === 200 && allow.data.allow.version === entry?.version && typeof allow.data.total === "number", allow.data);
const allowList = await api("GET", `${V1}/plugin-allow`);
check("白名单与预算", allowList.status === 200 && allowList.data.admin === true && allowList.data.allow.some((a) => a.id === ID) && allowList.data.budget.limit === 50000, allowList.data);
const wrongVer = await api("PUT", ALLOW, { version: "0.0.1" });
check("只能放行市场当前版本", wrongVer.status === 409, wrongVer.data);

const inst = await api("POST", `${V1}/plugins/${ID}/install`);
const key = inst.data?.key;
check("安装", inst.status === 200 && inst.data.install.channel === CHANNEL && inst.data.install.space === `plugin-${ID}` && !!key, inst.data);
check("接入语一段话: 命令行, 定时, 任务, 密钥", inst.data?.prompt?.includes(`hxaioa login`) && inst.data.prompt.includes("每 1800 秒") && inst.data.prompt.includes("插件任务") && inst.data.prompt.includes(key) && inst.data.key === key && !("request" in inst.data), inst.data?.prompt);
const after = await api("GET", `${V1}/plugins/${ID}`);
check("装好后任务提示词不含密钥", !!after.data.installed && after.data.task?.includes("插件任务") && !after.data.task.includes(key), after.data.task?.slice(0, 200));
const again = await api("POST", `${V1}/plugins/${ID}/install`);
check("重复安装被拒", again.status === 409, again.data);

// 更新: 市场出新版不会自己装, 管理员放行新版才换; 关了自动更新的要手动
const guideOld = await call(key, "GET", `${V1}/chat-agent/guide`);
bumped = "9.9.9";
const pinned = await api("GET", `${V1}/plugins/${ID}`);
check("市场出新版不自动装", pinned.data?.installed?.version === entry?.version && pinned.data.manifest.version === "9.9.9", pinned.data?.installed);
const re = await api("PUT", ALLOW, {});
const auto = await api("GET", `${V1}/plugins/${ID}`);
check("放行新版后自动更新", re.status === 200 && auto.data?.installed?.version === "9.9.9" && auto.data.installed.updated > 0 && auto.data.task?.includes(BUMP_MARK), auto.data?.installed);
const guideNew = await call(key, "GET", `${V1}/chat-agent/guide`);
check("更新后密钥照用, 专属指令换了版本", guideNew.status === 200 && guideNew.data.includes(BUMP_MARK) && guideNew.data !== guideOld.data, guideNew.status);
const autoOff = await api("PATCH", `${V1}/plugins/${ID}`, { auto: false });
check("关闭自动更新", autoOff.status === 200 && autoOff.data.install.auto === false, autoOff.data);
bumped = "9.9.10";
await api("PUT", ALLOW, {});
const held = await api("GET", `${V1}/plugins/${ID}`);
check("关了自动更新就停在旧版", held.data?.installed?.version === "9.9.9" && held.data.allowed?.version === "9.9.10", held.data?.installed);
const manual = await api("POST", `${V1}/plugins/${ID}/update`);
check("手动更新到放行的版本", manual.status === 200 && manual.data.install.version === "9.9.10" && manual.data.install.auto === false && manual.data.install.keyId === inst.data.install.keyId, manual.data);
bumped = null;
await api("PATCH", `${V1}/plugins/${ID}`, { auto: true });

const spaces = await api("GET", `${V1}/spaces`);
const space = spaces.data?.spaces?.find((s) => s.id === `plugin-${ID}`);
check("工作台已下发且占位符已替换", space?.panels?.[0]?.items?.[0]?.bind?.[0]?.subject === CHANNEL, space);
const chats = await api("GET", `${V1}/chats`);
const chat = chats.data?.chats?.find((c) => c.channel === CHANNEL);
check("建群并接入 Agent", chat?.title === "点子待办" && chat.agents?.[0]?.plugin === ID, chat);

const guide = await call(key, "GET", `${V1}/chat-agent/guide`);
check("专属指令带插件任务", guide.status === 200 && guide.data.includes("插件任务: 点子待办") && guide.data.includes("### 待办") && !guide.data.includes("{{"), guide.data);

const said = await api("POST", `${V1}/messages`, { text: "要不要做个插件市场?", channel: CHANNEL });
const msgs = await call(key, "GET", `${V1}/chats/${CHANNEL}/messages?since=0`);
const src = msgs.data?.messages?.find((m) => m.id === said.data?.id);
check("Agent 读得到本群", msgs.status === 200 && !!src, msgs.data);

const bad = await call(key, "POST", TODOS, { todos: [{ id: T1 }] });
check("新增待办缺 title 被拒", bad.status === 400, bad.data);
const made = await call(key, "POST", TODOS, { todos: [{ id: T1, title: "调研: 插件市场", prio: 3, src: src?.seq, note: "先做官方市场" }] });
check("Agent 新增待办", made.status === 200 && made.data.todos[0]?.state === "open" && made.data.todos[0]?.src === src?.seq, made.data);
const same = await call(key, "POST", TODOS, { todos: [{ id: T1, title: "调研: 插件市场" }] });
check("内容没变不写库", same.status === 200 && same.data.todos.length === 0, same.data);
const tick = await api("POST", TODOS, { todos: [{ id: T1, state: "done" }] });
check("主人勾选完成", tick.status === 200 && tick.data.todos[0]?.state === "done", tick.data);
const read = await api("GET", TODOS);
check("主人读待办", read.data?.todos?.find((t) => t.id === T1)?.note === "先做官方市场", read.data);
const other = await call(key, "POST", `${V1}/chats/other-${Date.now()}/todos`, { todos: [{ id: "x", title: "x" }] });
check("Agent 写不了别的群的待办", other.status === 403, other.data);

const reply = await call(key, "POST", `${V1}/messages`, { text: "**结论**: 值得做", reply: src?.seq });
const back = await call(key, "GET", `${V1}/chats/${CHANNEL}/messages?since=${src?.seq ?? 0}`);
check("Agent 引用回复", reply.status === 200 && back.data?.messages?.some((m) => m.reply?.seq === src?.seq), back.data);
const badReply = await call(key, "POST", `${V1}/messages`, { text: "x", reply: 999999999 });
check("引用不存在的消息被拒", badReply.status === 400, badReply.data);

const t2 = await call(key, "POST", TODOS, { id: "t-2", title: "临时" });
const del = await call(key, "DELETE", `${TODOS}/t-2`);
check("单条写入与删除", t2.status === 200 && del.status === 200, [t2.data, del.data]);

// 重新接入: 不带请求体的 POST, 返回新密钥和同样格式的接入语; 插件记录跟着换 keyId, 卸载仍能清掉
const rot = await api("POST", `${V1}/chats/${CHANNEL}/agents/${inst.data.install.keyId}/rotate`);
const key2 = rot.data?.key;
check("重新接入给出新密钥和插件接入语", rot.status === 200 && !!key2 && key2 !== key && rot.data.prompt.includes(key2) && rot.data.prompt.includes("每 1800 秒"), rot.data);
const oldDead = await call(key, "GET", `${V1}/chat-agent/guide`);
check("重新接入后旧密钥失效", oldDead.status === 401 || oldDead.status === 403, oldDead.status);
const off = await api("DELETE", `${V1}/plugins/${ID}`);
check("卸载", off.status === 200, off.data);
const gone = await api("GET", `${V1}/spaces`);
check("卸载后工作台移除", !gone.data?.spaces?.some((s) => s.id === `plugin-${ID}`), gone.data);
const dead = await call(key2 ?? key, "GET", `${V1}/chat-agent/guide`);
check("卸载后密钥失效", dead.status === 401 || dead.status === 403, dead.status);
const closed = await api("GET", TODOS);
check("卸载后待办接口关闭", closed.status === 404, closed.data);
const relist = await api("GET", `${V1}/plugins`);
check("卸载后显示未安装, 仍在白名单", relist.data?.plugins?.some((p) => p.id === ID && !p.installed && p.allowed), relist.data);
const back2 = await api("POST", `${V1}/plugins/${ID}/install`);
const kept = await api("GET", TODOS);
check("重新安装后待办还在", back2.status === 200 && kept.data?.todos?.some((t) => t.id === T1), kept.data);
const noData = await api("GET", `${V1}/pdata/${ID}/items`);
check("没申请 data:own 的插件用不了通用数据层", noData.status === 403, noData.data);
const revoke = await api("DELETE", ALLOW);
const afterRevoke = await api("GET", `${V1}/plugins`);
check("撤销放行: 已装的一并卸掉", revoke.status === 200 && afterRevoke.data?.plugins?.some((p) => p.id === ID && !p.installed && !p.allowed), afterRevoke.data);
const deadKey = await call(back2.data?.key ?? "", "GET", `${V1}/chat-agent/guide`);
check("撤销放行后插件密钥失效", deadKey.status === 401 || deadKey.status === 403, deadKey.status);

market.close();
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
