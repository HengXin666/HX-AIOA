#!/usr/bin/env node
// 撤回与删除冒烟测试: 墓碑换新 seq 实时下发, 断线设备按 since 补拉也能收到, Agent 撤回 / 删除权限, 云端翻页, 总览不再出现。
// 环境变量: AIOA_SERVER, AIOA_TOKEN (AUTH_TOKEN)
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const RUN = Date.now().toString(36);
const GROUP = `recall-${RUN}`;
const WAIT_MS = 3000;
const GET = "GET";
const POST = "POST";
const DELETE = "DELETE";
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failed += 1;
}

async function api(method, path, body, auth = token) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", "User-Agent": "hx-aioa-agent/1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function stream(query) {
  const ws = new WebSocket(`${server.replace(/^http/, "ws")}${V1}/stream?${new URLSearchParams(query)}`);
  const frames = [];
  ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
  const next = async (test) => {
    const end = Date.now() + WAIT_MS;
    while (Date.now() < end) {
      const hit = frames.find(test);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };
  const open = new Promise((r) => (ws.onopen = r));
  return { ws, next, open, send: (f) => ws.send(JSON.stringify(f)) };
}

const enc = encodeURIComponent;
const a = stream({ token, device: `android-a-${RUN}` });
await a.open;
const welcome = await a.next((f) => f.t === "welcome");
const start = welcome?.head ?? 0;

a.send({ t: "send", cid: `c1-${RUN}`, body: { kind: "text", text: "第一条" }, channel: GROUP });
const m1 = (await a.next((f) => f.t === "ev" && f.ev.cid === `c1-${RUN}`))?.ev;
a.send({ t: "send", cid: `c2-${RUN}`, body: { kind: "text", text: "第二条" }, channel: GROUP });
const m2 = (await a.next((f) => f.t === "ev" && f.ev.cid === `c2-${RUN}`))?.ev;
const pushed = await api(POST, `${V1}/messages`, { text: "推送的告警", channel: GROUP });
const m3 = (await a.next((f) => f.t === "ev" && f.ev.id === pushed.data?.id))?.ev;
check("发出三条", !!(m1 && m2 && m3), { m1, m2, m3 });

const recalled = await api(DELETE, `${V1}/events/seq/${m1.seq}?mode=recall`);
check("撤回自己的消息", recalled.status === 200 && recalled.data.deleted?.mode === "recall" && recalled.data.id === m1.id && recalled.data.seq > m3.seq, recalled.data);
const live = await a.next((f) => f.t === "ev" && f.ev.id === m1.id && f.ev.deleted);
check("墓碑实时下发, 带原 seq", live?.ev.deleted.seq === m1.seq && !live.ev.data.summary, live);

const notMine = await api(DELETE, `${V1}/events/seq/${m3.seq}?mode=recall`);
check("别人发的消息不能撤回", notMine.status === 403, notMine.data);
const removed = await api(DELETE, `${V1}/events/seq/${m3.seq}?mode=delete`);
check("删除任意消息", removed.status === 200 && removed.data.deleted?.mode === "delete", removed.data);
const gone = await api(GET, `${V1}/events/seq/${m3.seq}`);
check("原 seq 不再存在", gone.status === 404, gone.data);
const badMode = await api(DELETE, `${V1}/events/seq/${m2.seq}?mode=nuke`);
check("mode 取值校验", badMode.status === 400, badMode.data);

const OTHER = `other-${RUN}`;
const made = await api(POST, `${V1}/chats/${enc(GROUP)}/agents`, { name: "撤回测试" });
const agentKey = /密钥: (\S+)/.exec(made.data?.prompt ?? "")?.[1] ?? "";
check("接入 Agent", made.status === 200 && !!agentKey, made.data);
const own = await api(POST, `${V1}/messages`, { text: "Agent 的消息" }, agentKey);
const ownEv = (await a.next((f) => f.t === "ev" && f.ev.id === own.data?.id))?.ev;
const agentRecall = await api(DELETE, `${V1}/events/seq/${ownEv?.seq}?mode=recall`, undefined, agentKey);
check("Agent 随时撤回自己的消息", agentRecall.status === 200 && agentRecall.data.deleted?.mode === "recall", agentRecall.data);
const agentDel = await api(DELETE, `${V1}/events/seq/${m2.seq}?mode=delete`, undefined, agentKey);
check("Agent 删除本群别人的消息", agentDel.status === 200 && agentDel.data.deleted?.mode === "delete", agentDel.data);
const outside = await api(POST, `${V1}/messages`, { text: "别的群", channel: OTHER });
const outsideEv = (await a.next((f) => f.t === "ev" && f.ev.id === outside.data?.id))?.ev;
const agentFar = await api(DELETE, `${V1}/events/seq/${outsideEv?.seq}?mode=delete`, undefined, agentKey);
check("Agent 不能删别的群", agentFar.status === 403, agentFar.data);
const agentNotMine = await api(DELETE, `${V1}/events/seq/${outsideEv?.seq}?mode=recall`, undefined, agentKey);
check("Agent 不能撤回别人的", agentNotMine.status === 403, agentNotMine.data);

const b = stream({ token, device: `android-b-${RUN}`, since: String(start) });
await b.open;
await b.next((f) => f.t === "welcome");
await new Promise((r) => setTimeout(r, 500));
const replay = await b.next((f) => f.t === "ev" && f.ev.id === m1.id);
const stale = await b.next((f) => f.t === "ev" && f.ev.seq === m1.seq);
check("断线设备补拉拿到墓碑, 不再拿到原消息", replay?.ev.deleted?.mode === "recall" && stale === null, { replay, stale });

a.send({ t: "send", cid: `c4-${RUN}`, body: { kind: "text", text: "第四条" }, channel: GROUP });
await a.next((f) => f.t === "ev" && f.ev.cid === `c4-${RUN}`);
const page = await api(GET, `${V1}/chats/${enc(GROUP)}/messages?before=${Number.MAX_SAFE_INTEGER}&limit=2`);
const ids = page.data?.messages?.map((m) => m.id) ?? [];
check("云端翻页取最近两条", page.status === 200 && ids.length === 2 && page.data.messages[0].seq < page.data.messages[1].seq, page.data);
const older = await api(GET, `${V1}/chats/${enc(GROUP)}/messages?before=${page.data.messages[0].seq}&limit=10`);
check("再往前翻一页", older.status === 200 && older.data.messages.every((m) => m.seq < page.data.messages[0].seq), older.data);

const ov = await api(GET, `${V1}/overview`);
const inOverview = Object.values(ov.data?.layers ?? {}).flat().some((it) => it.ev.id === m3.id || it.ev.id === m1.id);
check("总览不显示墓碑", ov.status === 200 && !inOverview, ov.data?.layers);

await api(DELETE, `${V1}/chats/${enc(GROUP)}/agents/${made.data?.agent?.keyId}`);
await api(DELETE, `${V1}/chats/${enc(GROUP)}/messages`);
await api(DELETE, `${V1}/chats/${enc(OTHER)}/messages`);
a.ws.close();
b.ws.close();
console.log(failed ? `${failed} 项失败` : "全部通过");
process.exit(failed ? 1 : 0);
