#!/usr/bin/env node
// 插件冒烟测试: 本机起一个静态服务充当市场 (仓库 plugins/ 目录), 服务端用 --var PLUGIN_MARKET 指过来
// 列表 -> 详情 -> 安装 (群, Agent, 工作台) -> Agent 拉指令, 写待办, 引用回复 -> 主人勾选 -> 卸载
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
let failed = 0;

const market = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url ?? "/")).replace(/^(\.\.[/\\])+/, "");
  try {
    res.end(await readFile(join(ROOT, path)));
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

// 上次跑到一半留下的安装先清掉
await api("DELETE", `${V1}/plugins/${ID}`);

const list = await api("GET", `${V1}/plugins`);
const entry = list.data?.plugins?.find((p) => p.id === ID);
check("市场列表", list.status === 200 && !!entry && !entry.installed && !list.data.error, list.data);
const detail = await api("GET", `${V1}/plugins/${ID}`);
check("插件详情带介绍", detail.status === 200 && detail.data.readmeType === "markdown" && detail.data.readme.includes("点子待办"), detail.data);
const missing = await api("POST", `${V1}/plugins/nope/install`);
check("市场里没有的插件装不了", missing.status === 404, missing.data);

const inst = await api("POST", `${V1}/plugins/${ID}/install`);
const key = /密钥: (\S+)/.exec(inst.data?.prompt ?? "")?.[1];
check("安装", inst.status === 200 && inst.data.install.channel === CHANNEL && inst.data.install.space === `plugin-${ID}` && !!key, inst.data);
check("接入语带定时建议与插件步骤", inst.data?.prompt?.includes("建议的定时") && inst.data.prompt.includes("插件任务"), inst.data?.prompt);
const again = await api("POST", `${V1}/plugins/${ID}/install`);
check("重复安装被拒", again.status === 409, again.data);

const spaces = await api("GET", `${V1}/spaces`);
const space = spaces.data?.spaces?.find((s) => s.id === `plugin-${ID}`);
check("工作台已下发且占位符已替换", space?.panels?.[0]?.items?.[0]?.bind?.[0]?.subject === CHANNEL, space);
const chats = await api("GET", `${V1}/chats`);
const chat = chats.data?.chats?.find((c) => c.channel === CHANNEL);
check("建群并接入 Agent", chat?.title === "点子待办" && chat.agents?.[0]?.plugin === ID, chat);

const guide = await call(key, "GET", `${V1}/chat-agent/guide`);
check("专属指令带插件任务", guide.status === 200 && guide.data.includes("插件任务: 点子待办") && guide.data.includes("待办接口") && !guide.data.includes("{{"), guide.data);

const said = await api("POST", `${V1}/messages`, { text: "要不要做个插件市场?", channel: CHANNEL });
const msgs = await call(key, "GET", `${V1}/chats/${CHANNEL}/messages?since=0`);
const src = msgs.data?.messages?.find((m) => m.id === said.data?.id);
check("Agent 读得到本群", msgs.status === 200 && !!src, msgs.data);

const bad = await call(key, "POST", TODOS, { todos: [{ id: "t-1" }] });
check("新增待办缺 title 被拒", bad.status === 400, bad.data);
const made = await call(key, "POST", TODOS, { todos: [{ id: "t-1", title: "调研: 插件市场", prio: 3, src: src?.seq, note: "先做官方市场" }] });
check("Agent 新增待办", made.status === 200 && made.data.todos[0]?.state === "open" && made.data.todos[0]?.src === src?.seq, made.data);
const same = await call(key, "POST", TODOS, { todos: [{ id: "t-1", title: "调研: 插件市场" }] });
check("内容没变不写库", same.status === 200 && same.data.todos.length === 0, same.data);
const tick = await api("POST", TODOS, { todos: [{ id: "t-1", state: "done" }] });
check("主人勾选完成", tick.status === 200 && tick.data.todos[0]?.state === "done", tick.data);
const read = await api("GET", TODOS);
check("主人读待办", read.data?.todos?.length === 1 && read.data.todos[0].note === "先做官方市场", read.data);
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

const off = await api("DELETE", `${V1}/plugins/${ID}`);
check("卸载", off.status === 200, off.data);
const gone = await api("GET", `${V1}/spaces`);
check("卸载后工作台移除", !gone.data?.spaces?.some((s) => s.id === `plugin-${ID}`), gone.data);
const dead = await call(key, "GET", `${V1}/chat-agent/guide`);
check("卸载后密钥失效", dead.status === 401 || dead.status === 403, dead.status);
const kept = await api("GET", TODOS);
check("卸载后待办保留", kept.data?.todos?.length === 1, kept.data);
const relist = await api("GET", `${V1}/plugins`);
check("卸载后显示未安装", relist.data?.plugins?.some((p) => p.id === ID && !p.installed), relist.data);

market.close();
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
