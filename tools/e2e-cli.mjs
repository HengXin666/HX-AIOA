#!/usr/bin/env node
// CLI 与群状态冒烟测试: 接入 Agent, CLI login/send/read/watch --once, 长连监听名单, 输入提示与开关。
// 环境变量: AIOA_SERVER, AIOA_TOKEN (AUTH_TOKEN)
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const RUN = Date.now().toString(36);
const GROUP = `cli-${RUN}`;
const WAIT_MS = 4000;
const CLI = new URL("../cli/src/main.mjs", import.meta.url).pathname;
const HOME = mkdtempSync(join(tmpdir(), "hxaioa-"));
const run = promisify(execFile);
let failed = 0;
const enc = encodeURIComponent;

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failed += 1;
}

async function api(method, path, body, auth = token) {
  const res = await fetch(server + path, { method, headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const env = { ...process.env, HXAIOA_HOME: HOME, AIOA_SERVER: "", AIOA_KEY: "" };
const cli = (...args) => run("node", [CLI, ...args], { env, timeout: 20000 }).then((r) => r.stdout, (e) => `ERR ${e.code} ${e.stderr}${e.stdout}`);

function client() {
  const ws = new WebSocket(`${server.replace(/^http/, "ws")}${V1}/stream?${new URLSearchParams({ token, device: `android-ui-${RUN}` })}`);
  const frames = [];
  ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
  const next = async (test) => {
    const end = Date.now() + WAIT_MS;
    while (Date.now() < end) {
      const i = frames.findIndex(test);
      if (i >= 0) return frames.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };
  return { ws, next, open: new Promise((r) => (ws.onopen = r)), send: (f) => ws.send(JSON.stringify(f)) };
}

const ui = client();
await ui.open;
await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { title: "CLI 测试" });
const made = await api("POST", `${V1}/chats/${enc(GROUP)}/agents`, { name: "小助手", reads: [GROUP] });
check("接入 Agent", made.status === 200 && made.data.key, made);
const key = made.data.key;

const login = await cli("login", server, key);
check("CLI login", login.includes("小助手") && login.includes(GROUP), login);
const me = JSON.parse(await cli("me"));
check("CLI me", me.channel === GROUP && me.name === "小助手", me);

// 指令更新: 报到记版本与客户端; 改成信息流后服务端在群里通知, CLI 提示, 再报到后自动记一笔
check("guide --ack", (await cli("guide", "--ack")).includes("已报到"));
const agentOf = async () => (await api("GET", `${V1}/chats`)).data.chats.find((m) => m.channel === GROUP)?.agents?.[0];
const a1 = await agentOf();
check("报到记下版本与客户端", !!a1?.version && a1.client?.startsWith("hxaioa ") && !a1.pending, a1);
await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { view: "feed" });
const warn = await run("node", [CLI, "me"], { env, timeout: 20000 }).then((r) => r.stderr, (e) => String(e.stderr));
check("CLI 提示指令已更新", warn.includes("专属指令已更新"), warn);
const texts = async () => ((await api("GET", `${V1}/chats/${enc(GROUP)}/messages?since=0`)).data?.messages ?? []).map((m) => JSON.stringify(m.data)).join("\n");
check("群里自动通知指令更新", (await texts()).includes("小助手 的专属指令已更新到"));
check("待更新", (await agentOf())?.pending === true);
check("信息流群的指令带 feed 格式", (await cli("guide", "--ack")).includes("推送格式: 信息流"));
const a2 = await agentOf();
check("报到后自动记一笔", (await texts()).includes("小助手 已更新到专属指令") && a2?.version !== a1.version && !a2.pending, a2);
await run("node", [CLI, "me"], { env, timeout: 20000 }).then((r) => check("报到后不再提示", !r.stderr.includes("专属指令已更新"), r.stderr), (e) => check("报到后不再提示", false, String(e)));
await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { view: "chat" });
await cli("guide", "--ack");

const sent = JSON.parse(await cli("send", "CLI 你好"));
check("CLI send 到本群", sent.channel === GROUP, sent);
await api("POST", `${V1}/messages`, { text: "主人说话", channel: GROUP });
const read = await cli("read", "--new");
check("CLI read --new", read.includes("CLI 你好") && read.includes("主人说话"), read);
check("read --new 第二次为空", (await cli("read", "--new")).trim() === "");

// HTTP 拉取算在监听
const polled = await ui.next((f) => f.t === "presence" && f.channel === GROUP && f.listening.some((x) => x.name === "小助手"));
check("拉取后显示正在监听", !!polled && polled.listening[0].until > Date.now(), polled);

// watch --once: 长连监听, 主人发一条就退出
const watching = cli("watch", "--once", "--timeout", "10", "--json");
const live = await ui.next((f) => f.t === "presence" && f.channel === GROUP && f.listening.some((x) => x.name === "小助手" && !x.until));
check("长连接上显示在监听 (无到期)", !!live, live);
await api("POST", `${V1}/messages`, { text: "叫一下小助手", channel: GROUP });
const got = await watching;
check("watch --once 收到新消息", got.includes("叫一下小助手") && !got.includes("CLI 你好"), got);
const gone = await ui.next((f) => f.t === "presence" && f.channel === GROUP && !f.listening.some((x) => !x.until));
check("断开后长连监听移除", !!gone, gone);
check("watch --timeout 超时退出码 2", (await cli("watch", "--once", "--timeout", "2")).startsWith("ERR 2"));

// 0.3.0: --window 跨调用累计, 本次到点但窗口没满退出码 4
check("watch --window 未满退出码 4", (await cli("watch", "--once", "--window", "5", "--timeout", "2")).startsWith("ERR 4"));
check("watch --window 满了退出码 2", (await cli("watch", "--once", "--window", "5", "--timeout", "10")).startsWith("ERR 2"));

// 主人改设置: 服务端当场推 guide 帧, 正在等的 watch 退出码 3, 系统通知不当成主人的话
const waitGuide = cli("watch", "--once", "--timeout", "10", "--json");
await new Promise((r) => setTimeout(r, 1500));
await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { view: "feed" });
const g3 = await waitGuide;
check("改设置后 watch 退出码 3", g3.startsWith("ERR 3") && g3.includes('"guide"'), g3);
await cli("guide", "--ack");
await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { view: "chat" });
await cli("guide", "--ack");

// 长期记忆存服务端
check("记忆为空", (await cli("memory")).includes("还没有记忆"));
check("记忆追加", (await cli("memory", "--add", "主人喜欢短回复")).includes("已记"));
check("记忆读回", (await cli("memory")).includes("主人喜欢短回复"));
const big = await cli("memory", "--set", "x".repeat(4001));
check("记忆超长被拒", big.startsWith("ERR 1") && big.includes("4000"), big);
check("记忆清空", JSON.parse(await cli("memory", "--set", "")).text === "");

// 待办: 一行一条, --all 含已完成
await api("POST", `${V1}/chats/${enc(GROUP)}/todos`, { todos: [{ id: "t-1", title: "写测试", state: "doing" }, { id: "t-2", title: "早做完了", state: "done" }] });
const td = await cli("todos");
check("todos 列未完成", td.includes("[进行中]") && td.includes("t-1") && !td.includes("t-2"), td);
check("todos --all 含已完成", (await cli("todos", "--all")).includes("[已完成]"));

// 输入提示: 人走长连接, Agent 走 HTTP; 发出消息后消失
ui.send({ t: "typing", channel: GROUP });
const typing = await ui.next((f) => f.t === "presence" && f.channel === GROUP && f.typing.length === 1);
check("主人正在输入", !!typing && typing.typing[0].until > Date.now(), typing);
await cli("typing");
const both = await ui.next((f) => f.t === "presence" && f.channel === GROUP && f.typing.some((x) => x.name === "小助手"));
check("Agent 正在输入", !!both, both);
await cli("send", "回复好了");
const cleared = await ui.next((f) => f.t === "presence" && f.channel === GROUP && !f.typing.some((x) => x.name === "小助手"));
check("Agent 发出后不再显示输入", !!cleared, cleared);

// 开关: 关掉输入提示后不再推
const off = await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { hideTyping: true, hideListening: true });
check("关闭提示开关", off.data?.chat?.hideTyping === true && off.data?.chat?.hideListening === true, off.data);
await new Promise((r) => setTimeout(r, 300));
ui.ws.close();
const ui2 = client();
await ui2.open;
await api("POST", `${V1}/chats/${enc(GROUP)}/typing`, {}, key);
check("关闭后不推输入", !(await ui2.next((f) => f.t === "presence" && f.channel === GROUP && f.typing.length)));
ui2.ws.close();

// 删除群: 消息, Agent key 一起删, 群资料只留墓碑; 再设置同名群就复活
const del = await api("DELETE", `${V1}/chats/${enc(GROUP)}`);
check("删除群", del.status === 200 && del.data.deleted >= 3, del.data);
const after = await api("GET", `${V1}/chats/${enc(GROUP)}/messages?since=0`);
check("删除后没有消息", after.data?.messages?.length === 0, after.data);
check("删除后 Agent 密钥失效", (await api("GET", `${V1}/chat-agent/me`, undefined, key)).status === 401);
const list = await api("GET", `${V1}/chats`);
const tomb = list.data.chats.find((m) => m.channel === GROUP);
check("群资料只剩墓碑", !!tomb?.deleted && !tomb.title && !tomb.agents, tomb);
const again = await api("PATCH", `${V1}/chats/${enc(GROUP)}`, { title: "又建了" });
check("同名群重建后不再是墓碑", again.data?.chat?.title === "又建了" && !again.data.chat.deleted, again.data);
await api("DELETE", `${V1}/chats/${enc(GROUP)}`);
console.log(failed ? `${failed} 项失败` : "全部通过");
process.exit(failed ? 1 : 0);
