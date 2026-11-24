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

await api("DELETE", `${V1}/chats/${enc(GROUP)}/agents/${made.data.agent.keyId}`);
console.log(failed ? `${failed} 项失败` : "全部通过");
process.exit(failed ? 1 : 0);
