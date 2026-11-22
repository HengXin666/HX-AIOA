#!/usr/bin/env node
import { createHmac } from "node:crypto";
// v1 服务端冒烟测试: 对一个本地 wrangler dev (或测试部署) 跑一遍事件, 规则, 来源, Agent 主流程。
// 环境变量: AIOA_SERVER (如 http://127.0.0.1:8787), AIOA_TOKEN (AUTH_TOKEN)
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const JSON_TYPE = "application/json";
const WAIT_MS = 3000;
// 每次运行用不同的键, 可以对同一个实例重复跑
const RUN = Date.now().toString(36);
const TASK = `deploy-${RUN}`;
const POST = "POST";
const GET = "GET";
const PUT = "PUT";
const FULL = "full";
const PUSH = { mode: "push" };
const F_CPU = "cpu";
const F_MEM = "mem";
const CT = "Content-Type";
const LEGACY_TEXT = "旧接口消息";
const GO = "go";
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failed += 1;
}

async function api(method, path, body, auth = token) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${auth}`, CT: JSON_TYPE },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function stream(query, path = `${V1}/stream`) {
  const url = `${server.replace(/^http/, "ws")}${path}?${new URLSearchParams(query)}`;
  const ws = new WebSocket(url);
  const frames = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const f = JSON.parse(String(e.data));
    frames.push(f);
    for (const w of [...waiters]) if (w.test(f)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(f);
    }
  };
  const next = (test) =>
    new Promise((resolve) => {
      const hit = frames.find(test);
      if (hit) return resolve(hit);
      const w = { test, resolve };
      waiters.push(w);
      setTimeout(() => resolve(null), WAIT_MS);
    });
  const open = new Promise((r) => (ws.onopen = r));
  return { ws, frames, next, open, send: (f) => ws.send(JSON.stringify(f)) };
}

const health = await fetch(`${server}/health`).then((r) => r.json());
check("health", health.ok === true && health.v === 2);

const downEvent = { title: "nas 掉线", severity: "critical", subject: "nas", dedupeKey: `nas-down-${RUN}`, groupKey: `host:nas-${RUN}` };
const crit = await api(POST, `${V1}/events`, downEvent);
const first = await api(GET, `${V1}/events?since=0&limit=500`);
const evCrit = first.data.events.find((e) => e.id === crit.data.id);
check("critical 事件强提醒", evCrit?.route?.action === "alert", JSON.stringify(evCrit?.route));

const again = await api(POST, `${V1}/events`, downEvent);
check("dedupeKey 覆盖同一 id", again.data.id === crit.data.id);

const child = await api(POST, `${V1}/events`, { title: "博客不可达", severity: "critical", subject: "blog", groupKey: `host:nas-${RUN}` });
const list = (await api(GET, `${V1}/events?since=0&limit=500`)).data.events;
const evChild = list.find((e) => e.id === child.data.id);
check("关联事件只推根因", evChild?.route?.action === "silent" && evChild?.root === crit.data.id, JSON.stringify(evChild?.route));
check("覆盖后旧行消失", list.filter((e) => e.id === crit.data.id).length === 1);

const legacy = await api(POST, "/api/send", { src: "e2e", body: { kind: "text", text: LEGACY_TEXT } });
const msgs = (await api(GET, `/api/messages?since=${legacy.data.seq - 1}`)).data;
check("旧接口 /api/send 与 /api/messages", msgs[0]?.t === "msg" && msgs[0]?.body?.text === LEGACY_TEXT);
const old = stream({ token, device: "web-legacy", since: String(legacy.data.seq - 1) }, "/ws");
const oldMsg = await old.next((f) => f.t === "msg" && f.seq === legacy.data.seq);
check("旧 /ws 收到 msg 帧", oldMsg?.body?.text === LEGACY_TEXT);
old.send({ t: "send", cid: `c-${RUN}`, body: { kind: "text", text: "旧客户端发送" } });
const sent = await old.next((f) => f.t === "sent" && f.cid === `c-${RUN}`);
const echo = await old.next((f) => f.t === "msg" && f.cid === `c-${RUN}`);
check("旧客户端 send 回执与回显", Boolean(sent && echo));
old.ws.close();

const rule = await api(POST, `${V1}/rules`, { name: "噪音丢弃", when: { keywords: ["噪音"] }, action: "drop" });
const noisy = await api(POST, `${V1}/events`, { title: "一条噪音" });
check("用户规则 drop", noisy.data.delivered === 0, JSON.stringify(noisy.data));
const rules = (await api(GET, `${V1}/rules`)).data.rules;
check("规则列表含内置规则", rules.some((r) => r.id === "builtin:default") && rules[0].id === rule.data.id);
const dry = await api(POST, `${V1}/rules/test`, { title: "又一条噪音" });
check("规则试运行", dry.data.route?.action === "drop");
await api("DELETE", `${V1}/rules/${rule.data.id}`);

const src = await api(POST, `${V1}/sources`, { name: "家里 Kuma", type: "uptime-kuma", key: {} });
// wrangler dev 会把 url 改写成 wrangler.toml 里的正式域名, 这里只取路径
const hookUrl = server + new URL(src.data.key?.webhookUrls?.["uptime-kuma"] ?? "http://x/").pathname;
check("创建来源同时发 key", Boolean(hookUrl && src.data.key.key));
const hook = await fetch(`${hookUrl}?key=${src.data.key.key}`, {
  method: POST,
  headers: { CT: JSON_TYPE },
  body: JSON.stringify({ heartbeat: { status: 0, msg: "timeout" }, monitor: { id: 1, name: "相册", url: "https://photo.home" } }),
}).then((r) => r.json());
check("Uptime Kuma webhook 入库", hook.results?.length === 1, JSON.stringify(hook));
const badHook = await fetch(hookUrl, { method: POST, body: "{}" });
check("webhook 无 key 拒绝", badHook.status === 401);
const ov = (await api(GET, `${V1}/overview`)).data;
check("总览 need_me 层", ov.layers.need_me.some((i) => i.ev.data.title.includes("相册")));

const agentKey = (await api(POST, `${V1}/keys`, { name: "dsh", scopes: ["agent"] })).data;
const agent = stream({ token: agentKey.key, role: "agent", device: `agent-${RUN}` });
const client = stream({ token, device: "web-e2e" });
await Promise.all([agent.open, client.open]);
agent.send({ t: "agent_hello", agent: { id: `dsh-${RUN}`, name: "DSH" } });
agent.send({ t: "task", taskId: TASK, op: "create", title: "部署" });
await agent.next((f) => f.t === "task" && f.task.id === TASK);
agent.send({ t: "task", taskId: TASK, op: "wait", prompt: { question: "切流量?", options: [{ id: GO, label: "切", style: "danger" }], timeoutSec: 600 } });
const waiting = await client.next((f) => f.t === "task" && f.task.state === "waiting");
check("客户端收到等待确认", Boolean(waiting?.task?.prompt));
client.send({ t: "act", aid: `a1-${RUN}`, taskId: TASK, kind: "approve", option: GO });
const needConfirm = await client.next((f) => f.t === "err" && f.aid === `a1-${RUN}`);
check("危险动作需要二次确认", needConfirm?.code === "need_confirm");
client.send({ t: "act", aid: `a2-${RUN}`, taskId: TASK, kind: "approve", option: GO, confirm: true });
const ok = await client.next((f) => f.t === "act_ok" && f.aid === `a2-${RUN}`);
check("确认后投递给在线 Agent", ok?.state === "delivered");
const got = await agent.next((f) => f.t === "act" && f.action.aid === `a2-${RUN}`);
check("Agent 收到动作", got?.action?.promptId !== undefined);
agent.send({ t: "act_ack", aid: `a2-${RUN}` });
const dup = await api(POST, `${V1}/tasks/${TASK}/actions`, { aid: `a2-${RUN}`, kind: "approve", option: GO, confirm: true });
check("同一 aid 幂等", dup.data.state === "duplicate");

agent.ws.close();
await new Promise((r) => setTimeout(r, 300));
const queued = await api(POST, `${V1}/tasks/${TASK}/actions`, { aid: `a3-${RUN}`, kind: "ask", text: "进度如何?" });
check("Agent 离线时排队", queued.data.state === "queued", JSON.stringify(queued.data));
const pending = await api(GET, `${V1}/agent/actions?agent=dsh-${RUN}`, undefined, agentKey.key);
check("HTTP 拉取排队动作", pending.data.actions.some((a) => a.aid === `a3-${RUN}`));
const detail = (await api(GET, `${V1}/tasks/${TASK}`)).data;
check("任务对话历史", detail.log.length >= 4, String(detail.log?.length));
const forbidden = await api(GET, `${V1}/events`, undefined, agentKey.key);
check("接入 key 不能读收件箱", forbidden.status === 403);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timed = `wait-${RUN}`;
await api(POST, `${V1}/agent/tasks`, { taskId: timed, op: "create", agent: `dsh-${RUN}`, title: "超时测试" }, agentKey.key);
await api(POST, `${V1}/agent/tasks`, { taskId: timed, op: "wait", prompt: { question: "继续?", timeoutSec: 1 } }, agentKey.key);
const aggRule = await api(POST, `${V1}/rules`, { name: "聚合测试", when: { keywords: [`agg-${RUN}`] }, action: "aggregate", aggregateSec: 2 });
for (let i = 0; i < 3; i += 1) await api(POST, `${V1}/events`, { title: `agg-${RUN} 磁盘`, subject: "nas" });
await sleep(3500);
const expiredActs = (await api(GET, `${V1}/agent/actions?agent=dsh-${RUN}`, undefined, agentKey.key)).data.actions;
check("确认超时投递拒绝", expiredActs.some((a) => a.taskId === timed && a.timeout === true));
const timedTask = (await api(GET, `${V1}/tasks/${timed}`)).data.task;
check("超时后任务回到运行", timedTask.state === "running" && timedTask.prompt?.expired === true, JSON.stringify(timedTask));
const all = (await api(GET, `${V1}/events?since=0&limit=500`)).data.events;
const summary = all.find((e) => e.data?.title === `3 条: agg-${RUN} 磁盘`);
check("聚合窗口结束推一条汇总", summary?.route?.merged === 3 && summary?.route?.action === "push", JSON.stringify(summary?.route));
await api("DELETE", `${V1}/rules/${aggRule.data.id}`);

const ghKey = (await api(POST, `${V1}/keys`, { name: "gh", scopes: ["events:write"] })).data;
const ghUrl = server + new URL(ghKey.webhookUrls.github).pathname;
const ghBody = JSON.stringify({ zen: "hi", repository: { full_name: "HengXin666/HX-AIOA" } });
const sig = `sha256=${createHmac("sha256", ghKey.webhookSecret).update(ghBody).digest("hex")}`;
const gh = await fetch(ghUrl, { method: POST, headers: { CT: JSON_TYPE, "X-GitHub-Event": "ping", "X-Hub-Signature-256": sig }, body: ghBody });
check("GitHub 验签通过", gh.status === 200);
const ghBad = await fetch(ghUrl, { method: POST, headers: { CT: JSON_TYPE, "X-GitHub-Event": "ping", "X-Hub-Signature-256": "sha256=00" }, body: ghBody });
check("GitHub 错误签名拒绝", ghBad.status === 401);

const st = await api("PATCH", `${V1}/settings`, { tz: "Asia/Shanghai", quiet: { start: "23:00", end: "08:00" } });
check("设置", st.data.settings?.quiet?.start === "23:00");

const spaceId = `srv-${RUN}`;
const btn = { id: "restart", type: "button", title: "重启", action: { agent: `dsh-${RUN}`, command: "restart", danger: true } };
const host = `nas-${RUN}`;
const ring = { id: F_MEM, type: "ring", question: "内存还够不够?", bind: [{ subject: host, field: F_MEM }] };
const nasPanel = { id: "nas", title: "NAS", refresh: PUSH, items: [{ id: F_CPU, type: "value", bind: [{ subject: host, field: F_CPU }] }, ring, btn] };
const logPanel = { id: "log", title: "动态", size: "l", refresh: PUSH, items: [{ id: "ev", type: "list", bind: [{ subject: host, field: "events" }] }] };
const space = { id: spaceId, title: "服务器", panels: [nasPanel, logPanel] };
const badSpace = await api(POST, `${V1}/spaces`, { ...space, panels: [{ ...nasPanel, items: [{ id: "x", type: "sparkline" }] }] });
check("工作台校验失败列出错误", badSpace.status === 400 && badSpace.data.errors?.length === 2, JSON.stringify(badSpace.data));
check("图表缺 question 被拒", badSpace.data.errors?.some((e) => e.includes("question")));
const spaceUpd = client.next((f) => f.t === "space_update" && f.id === spaceId);
check("下发工作台", (await api(POST, `${V1}/spaces`, space)).data.ok === true);
check("客户端收到 space_update", !!(await spaceUpd));
await api(PUT, `${V1}/spaces/${spaceId}/state`, { order: ["nas"] });
await api(POST, `${V1}/spaces`, space);
const sizeUpd = client.next((f) => f.t === "space_update" && f.id === spaceId && f.space?.state?.sizes?.nas === FULL);
const resized = await api(PUT, `${V1}/spaces/${spaceId}/state`, { sizes: { nas: FULL } });
check("调整面板尺寸", resized.status === 200 && resized.data.space?.state?.sizes?.nas === FULL, JSON.stringify(resized.data));
check("尺寸变化推给其他设备", !!(await sizeUpd));
const badSize = await api(PUT, `${V1}/spaces/${spaceId}/state`, { sizes: { nas: "huge" } });
const ghost = await api(PUT, `${V1}/spaces/${spaceId}/state`, { order: ["ghost"] });
check("非法尺寸与未知面板被拒", badSize.status === 400 && ghost.status === 400, `${badSize.status} ${ghost.status}`);
await api(POST, `${V1}/spaces`, space);
const spaces = (await api(GET, `${V1}/spaces`)).data.spaces;
const kept = spaces.find((x) => x.id === spaceId)?.state;
check("重新下发不覆盖用户排序与尺寸", kept?.order?.[0] === "nas" && kept?.sizes?.nas === FULL, JSON.stringify(kept));

await api(POST, `${V1}/events`, { kind: "metric", subject: host, data: { values: { cpu_percent: 12 } } });
const metricKey = (await api(POST, `${V1}/keys`, { name: "prom", scopes: ["events:write"] })).data;
const promUrl = `${server}${new URL(metricKey.webhookUrls.prometheus).pathname}?key=${metricKey.key}`;
const prom = await fetch(promUrl, { method: POST, headers: { CT: JSON_TYPE }, body: JSON.stringify({ metric: { instance: `${host}:9100`, field: F_MEM }, value: [Date.now() / 1000, "41.5"] }) });
check("Prometheus 指标经适配器入库", prom.status === 200, String(prom.status));
await api(POST, `${V1}/events`, { title: "备份完成", subject: host });
const data = (await api(GET, `${V1}/spaces/${spaceId}/data`)).data;
const val = (f) => data.values?.find((v) => v.subject === host && v.field === f);
check("按绑定解析当前值 (别名换成标准字段)", val(F_CPU)?.value === 12 && val(F_CPU)?.unit === "%", JSON.stringify(data.values));
check("换来源不改布局: Prometheus 的 mem 落到同一绑定", val(F_MEM)?.value === 41.5, JSON.stringify(data.values));
check("列表绑定解析出最近事件", data.events?.some((e) => e.data?.title === "备份完成"));
const pressId = `button:${spaceId}:restart`;
const noConfirm = await api(POST, `${V1}/tasks/${encodeURIComponent(pressId)}/actions`, { aid: `b1-${RUN}`, kind: "reply" });
check("危险按钮需要二次确认", noConfirm.status === 409);
const press = await api(POST, `${V1}/tasks/${encodeURIComponent(pressId)}/actions`, { aid: `b2-${RUN}`, kind: "reply", confirm: true });
check("按钮动作投递给 Agent", ["queued", "delivered"].includes(press.data.state), JSON.stringify(press.data));
await api("DELETE", `${V1}/spaces/${spaceId}`);

client.ws.close();
console.log(failed ? `共 ${failed} 项失败` : "全部通过");
process.exit(failed ? 1 : 0);
