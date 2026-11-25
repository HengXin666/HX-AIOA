#!/usr/bin/env node
// GitHub 授权插件 + 待办 1.5 冒烟测试 (不连 GitHub): base 插件安装, 依赖, Agent 权限, 仓库规则,
// 待办四态与关联字段, 外部接入密钥 (Markdown 与 MCP)。市场同 e2e-plugins: 本机静态服务 + --var PLUGIN_MARKET
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
const CHANNEL = "plugin-todo";
const TODOS = `${V1}/chats/${CHANNEL}/todos`;
const EXT = `${V1}/chats/${CHANNEL}/todos-ext`;
const DAY_MS = 86_400_000;
let failed = 0;

const market = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url ?? "/")).replace(/^(\.\.[/\\])+/, "");
  try {
    res.end(await readFile(join(ROOT, path), "utf8"));
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
    headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), "Content-Type": "application/json" },
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
// id 为 null 时是通知 (不带 id)
const rpc = (k, method, params, id = 1) => call(k, "POST", `${V1}/ext/mcp`, { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) });

await api("DELETE", `${V1}/plugins/todo`);
await api("DELETE", `${V1}/plugins/gh`);

const gh = await api("POST", `${V1}/plugins/gh/install`);
check("装 GitHub 授权 (base 插件, 不建群不发 key)", gh.status === 200 && gh.data.install.base === true && gh.data.install.channel === "" && gh.data.key === "", gh.data);
const ghDetail = await api("GET", `${V1}/plugins/gh`);
check("base 插件详情没有任务提示词", ghDetail.status === 200 && ghDetail.data.manifest.base === true && !ghDetail.data.task, ghDetail.data?.task);
const st = await api("GET", `${V1}/gh`);
check("未授权状态", st.status === 200 && !st.data.auth && st.data.device === false && Array.isArray(st.data.ops), st.data);
const devNo = await api("POST", `${V1}/gh/device`);
check("没配 GH_CLIENT_ID 时设备码给出原因", devNo.status === 400 && /GH_CLIENT_ID/.test(devNo.data.error), devNo.data);
const badTok = await api("PUT", `${V1}/gh/token`, { token: "x" });
check("令牌太短被拒", badTok.status === 400, badTok.data);

const inst = await api("POST", `${V1}/plugins/todo/install`);
const key = inst.data?.key;
check("装待办, 记下 gh 依赖", inst.status === 200 && inst.data.install.deps?.includes("gh"), inst.data?.install);
const guide = await call(key, "GET", `${V1}/chat-agent/guide`);
check("专属指令带四态和 GitHub issue 接口", guide.status === 200 && guide.data.includes("hold 挂起") && guide.data.includes("### GitHub issue") && guide.data.includes("/api/v1/gh/issues/"), guide.status);
const agents = (await api("GET", `${V1}/gh`)).data.agents ?? [];
const me = agents.find((a) => a.keyId === inst.data.install.keyId);
check("声明依赖的 Agent 默认有权限", me?.allowed === true && me.dep === true, agents);
const noAuth = await call(key, "GET", `${V1}/gh/issues/a/b`);
check("没授权时 Agent 调 issue 得到 409 和说明", noAuth.status === 409 && /授权/.test(noAuth.data.error), noAuth.data);
const ownerOnly = await call(key, "GET", `${V1}/gh`);
check("Agent 看不了授权设置", ownerOnly.status === 403, ownerOnly.data);
await api("PUT", `${V1}/gh/agents/${inst.data.install.keyId}`, { allowed: false });
const off = await call(key, "GET", `${V1}/gh/issues/a/b`);
check("关掉后 Agent 调 issue 403", off.status === 403, off.data);
await api("PUT", `${V1}/gh/agents/${inst.data.install.keyId}`, { allowed: true });

const rules = await api("PUT", `${V1}/gh/rules`, { pushedDays: 365, public: true, deny: ["a/b"] });
check("仓库快捷规则", rules.status === 200 && rules.data.rules.pushedDays === 365 && rules.data.rules.public === true, rules.data);
const badRules = await api("PUT", `${V1}/gh/rules`, { pushedDays: -1 });
check("规则校验", badRules.status === 400, badRules.data);

const put = await call(key, "POST", TODOS, { todos: [
  { id: "p-1", title: "Agent 接入专项", repo: "HengXin666/HX-AIOA", issue: 75 },
  { id: "c-1", title: "监听 30 秒就停", repo: "HengXin666/HX-AIOA", issue: 94, parent: "p-1", state: "hold" },
] });
check("待办带仓库, issue, 父子, 挂起", put.status === 200 && put.data.todos[1]?.state === "hold" && put.data.todos[1]?.parent === "p-1", put.data);
const done = await api("POST", TODOS, { todos: [{ id: "c-1", state: "done" }] });
check("完成时记下 doneAt", done.data?.todos?.[0]?.doneAt > 0, done.data);
const reopen = await api("POST", TODOS, { todos: [{ id: "c-1", state: "doing" }] });
check("离开完成去掉 doneAt", reopen.data?.todos?.[0] && !reopen.data.todos[0].doneAt, reopen.data);
const sync = await api("POST", `${V1}/chats/${CHANNEL}/todos-sync`);
check("没授权时同步什么也不做", sync.status === 200 && sync.data.changed === 0, sync.data);

// 外部接入
const ro = await api("POST", EXT, { name: "Hark", access: "read" });
const rk = ro.data?.key;
const ttl = (ro.data?.info?.expires ?? 0) - Date.now();
check("只读接入密钥默认 24 小时", ro.status === 200 && ttl > DAY_MS - 60_000 && ttl <= DAY_MS && ro.data.mcp.endsWith("/api/v1/ext/mcp") && ro.data.md.includes(rk), ro.data);
const md = await call(null, "GET", `${V1}/ext/todos.md?key=${rk}`);
check("Markdown 链接", md.status === 200 && md.data.includes("# 点子待办") && md.data.includes("`p-1`") && md.data.includes("  - [ ] `c-1` [进行中]"), md.data);
const init = await rpc(rk, "initialize", { protocolVersion: "2025-06-18" });
check("MCP initialize", init.data?.result?.serverInfo?.name === "hx-aioa-todo" && init.data.result.capabilities.tools, init.data);
const note = await rpc(rk, "notifications/initialized", undefined, null);
check("MCP 通知回 202", note.status === 202, note.status);
const tools = await rpc(rk, "tools/list");
check("只读密钥只看到 list_todos", tools.data?.result?.tools?.map((t) => t.name).join() === "list_todos", tools.data);
const listed = await rpc(rk, "tools/call", { name: "list_todos", arguments: { state: "all" } });
check("MCP 列待办", listed.data?.result?.content?.[0]?.text?.includes("监听 30 秒就停"), listed.data);
const denied = await rpc(rk, "tools/call", { name: "add_todo", arguments: { title: "x" } });
check("只读密钥不能写", denied.data?.result?.isError === true, denied.data);
const roTodos = await call(rk, "GET", TODOS);
const roChats = await call(rk, "GET", `${V1}/chats`);
const roOther = await call(rk, "GET", `${V1}/chats/other/todos`);
check("接入密钥只碰得到本群待办", roTodos.status === 200 && roChats.status === 403 && roOther.status === 403, [roTodos.status, roChats.status, roOther.status]);
const roWrite = await call(rk, "POST", TODOS, { id: "z", title: "z" });
check("只读密钥写待办 403", roWrite.status === 403, roWrite.data);
const roGh = await call(rk, "GET", `${V1}/gh/issues/a/b`);
check("接入密钥用不了 GitHub", roGh.status === 403, roGh.data);

const rw = await api("POST", EXT, { name: "Claude", access: "write", hours: 0 });
const wk = rw.data?.key;
check("可写密钥, hours 0 不过期", rw.status === 200 && !rw.data.info.expires, rw.data?.info);
const added = await rpc(wk, "tools/call", { name: "add_todo", arguments: { title: "外部加的", prio: 1 } });
const newId = /已新增 (\S+)/.exec(added.data?.result?.content?.[0]?.text ?? "")?.[1];
check("MCP 新增待办", !!newId, added.data);
const upd = await rpc(wk, "tools/call", { name: "update_todo", arguments: { id: newId, state: "hold" } });
const got = (await api("GET", TODOS)).data?.todos?.find((t) => t.id === newId);
check("MCP 改状态", upd.data?.result?.content?.[0]?.text?.startsWith("已更新") && got?.state === "hold", [upd.data, got]);
const keys = await api("GET", EXT);
check("列出接入密钥", keys.data?.keys?.length >= 2 && keys.data.keys.some((k) => k.name === "Hark" && k.access === "read"), keys.data);
const rm = await api("DELETE", `${EXT}/${ro.data.info.id}`);
const md2 = await call(null, "GET", `${V1}/ext/todos.md?key=${rk}`);
check("吊销后失效", rm.status === 200 && md2.status === 401, [rm.data, md2.status]);
await api("DELETE", `${EXT}/${rw.data.info.id}`);

await api("DELETE", `${TODOS}/${newId}`);
await api("DELETE", `${TODOS}/p-1`);
await api("DELETE", `${TODOS}/c-1`);
const un = await api("DELETE", `${V1}/plugins/todo`);
const un2 = await api("DELETE", `${V1}/plugins/gh`);
check("卸载两个插件", un.status === 200 && un2.status === 200, [un.data, un2.data]);

market.close();
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
