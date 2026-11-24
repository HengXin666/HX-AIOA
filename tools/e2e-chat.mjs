#!/usr/bin/env node
// 群聊冒烟测试: 建群, 接入 Agent (写本群, 读别的群), 引用, 转发, 收藏, 头像, 重新接入。
// 环境变量: AIOA_SERVER, AIOA_TOKEN (AUTH_TOKEN)
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const RUN = Date.now().toString(36);
const GROUP = `news-${RUN}`;
const DIGEST = `digest-${RUN}`;
const WAIT_MS = 3000;
const POST = "POST";
const GET = "GET";
const PUT = "PUT";
const PATCH = "PATCH";
const DELETE = "DELETE";
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failed += 1;
}

async function api(method, path, body, auth = token, headers = {}) {
  const raw = body instanceof Uint8Array;
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": raw ? "image/png" : "application/json", ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
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
const client = stream({ token, device: `android-ui-${RUN}` });
await client.open;

const made = await api(PATCH, `${V1}/chats/${enc(GROUP)}`, { title: "新闻", muted: true });
check("新建群", made.status === 200 && made.data.chat.title === "新闻" && made.data.chat.muted === true, made.data);
check("资料变化广播", Boolean(await client.next((f) => f.t === "chat_sync" && f.channel === GROUP)));
await api(PATCH, `${V1}/chats/${enc(DIGEST)}`, { title: "日报", digest: "daily" });

const writer = await api(POST, `${V1}/chats/${enc(GROUP)}/agents`, { name: "新闻抓取" });
check("接入写群 Agent", writer.status === 200 && writer.data.prompt.includes("hxaioa login") && writer.data.prompt.includes(writer.data.key) && writer.data.key.startsWith("hxk_"), writer.data);
const writerKey = writer.data.key ?? "";
const guideRes = await fetch(`${server}${V1}/chat-agent/guide`, { headers: { Authorization: `Bearer ${writerKey}` } });
const guideText = await guideRes.text();
const version = guideRes.headers.get("X-Aioa-Guide-Version") ?? "";
check("Agent 拉取指令", guideRes.status === 200 && version.length === 8 && guideText.includes(version) && guideText.includes(GROUP) && !guideText.includes("hxk_"), guideText);
check("旧版本报到被拒", (await api(POST, `${V1}/chat-agent/ack`, { version: "00000000" }, writerKey)).status === 409);
check("报到", (await api(POST, `${V1}/chat-agent/ack`, { version }, writerKey)).status === 200);
const joined = (await api(GET, `${V1}/chats`)).data.chats.find((c) => c.channel === GROUP)?.agents?.[0];
check("报到后状态为已接入", joined?.joined > 0 && joined.pending === false, joined);
const renamed = await api(PATCH, `${V1}/chats/${enc(GROUP)}/agents/${joined?.keyId}`, { name: "新闻抓取2" });
check("Agent 改名不用重新报到", renamed.status === 200 && renamed.data.agent.pending !== true, renamed.data);
const guide2 = await (await fetch(`${server}${V1}/chat-agent/guide`, { headers: { Authorization: `Bearer ${writerKey}` } })).text();
check("改名后指令里是新名字", guide2.includes("新闻抓取2"), guide2.slice(0, 200));
await api(PATCH, `${V1}/chats/${enc(GROUP)}/agents/${joined?.keyId}`, { name: "新闻抓取" });
check("母号不能拉 Agent 指令", (await api(GET, `${V1}/chat-agent/guide`)).status === 403);
const posted = await api(POST, `${V1}/messages`, { text: "**头条**: 测试" }, writerKey);
check("Agent 默认发到本群", posted.status === 200 && posted.data.channel === GROUP, posted.data);
const evFrame = await client.next((f) => f.t === "ev" && f.ev.channel === GROUP);
check("客户端实时收到群消息", Boolean(evFrame));
const denied = await api(GET, `${V1}/chats/${enc(GROUP)}/messages`, undefined, writerKey);
check("没给读权限不能读群", denied.status === 403, denied.status);

const curator = await api(POST, `${V1}/chats/${enc(DIGEST)}/agents`, { name: "精选", reads: [GROUP] });
const curatorKey = curator.data.key ?? "";
const curatorGuide = await (await fetch(`${server}${V1}/chat-agent/guide`, { headers: { Authorization: `Bearer ${curatorKey}` } })).text();
check("精选 Agent 指令含读群说明", curatorGuide.includes(GROUP) && curatorGuide.includes("-c <群>"), curatorGuide);
const read = await api(GET, `${V1}/chats/${enc(GROUP)}/messages?since=0`, undefined, curatorKey);
check("精选 Agent 读到新闻群", read.status === 200 && read.data.messages.length === 1 && read.data.head > 0, read.data);
const chatsForKey = await api(GET, `${V1}/chats`, undefined, curatorKey);
check("Agent 只看到可读的群且不含 Agent 信息", chatsForKey.data.chats.every((c) => c.channel === GROUP || c.channel === DIGEST) && chatsForKey.data.chats.every((c) => !c.agents), chatsForKey.data);
const report = await api(POST, `${V1}/events`, { kind: "report", data: { title: "日报", markdown: "# 今日精选" } }, curatorKey);
check("精选 Agent 发报告到日报群", report.status === 200 && report.data.channel === DIGEST, report.data);

const seq = evFrame?.ev.seq ?? 0;
client.send({ t: "send", cid: `r-${RUN}`, body: { kind: "text", text: "收到" }, reply: seq, channel: GROUP });
const replied = await client.next((f) => f.t === "ev" && f.ev.cid === `r-${RUN}`);
check("引用回复带快照并发到群", replied?.ev.reply?.seq === seq && replied.ev.reply.text.includes("头条") && replied.ev.channel === GROUP, replied?.ev);
check("人发的消息来源是人不是设备", replied?.ev.source.type === "user" && !!replied.ev.source.name && replied.ev.source.name !== `android-ui-${RUN}`, replied?.ev.source);
client.send({ t: "send", cid: `f-${RUN}`, body: { kind: "text", text: "" }, fwd: seq, channel: DIGEST });
const fwd = await client.next((f) => f.t === "ev" && f.ev.cid === `f-${RUN}`);
check("转发带原来源与全文", fwd?.ev.fwd?.src === "新闻抓取" && fwd.ev.channel === DIGEST && JSON.stringify(fwd.ev.data).includes("头条"), fwd?.ev);

const fav = await api(PUT, `${V1}/favorites/${seq}`);
check("收藏", fav.status === 200 && fav.data.favorite.seq === seq, fav.data);
const favs = await api(GET, `${V1}/favorites`);
const etag = favs.res.headers.get("ETag");
check("收藏列表", favs.data.favorites.some((f) => f.seq === seq) && Boolean(etag), favs.data);
const again = await fetch(`${server}${V1}/favorites`, { headers: { Authorization: `Bearer ${token}`, "If-None-Match": etag } });
check("收藏没变返回 304", again.status === 304, again.status);
check("收藏按引用带原消息全文", JSON.stringify(favs.data.favorites.find((f) => f.seq === seq)?.ev?.data ?? {}).includes("头条") && !favs.data.favorites.find((f) => f.seq === seq).gone, favs.data.favorites[0]);
const mineSeq = replied?.ev.seq ?? 0;
await api(PUT, `${V1}/favorites/${mineSeq}`);
await api(DELETE, `${V1}/events/seq/${mineSeq}?mode=recall`);
const afterRecall = (await api(GET, `${V1}/favorites`)).data.favorites.find((f) => f.seq === mineSeq);
check("原消息撤回后收藏随之移除", afterRecall === undefined, afterRecall);
check("取消收藏", (await api(DELETE, `${V1}/favorites/${seq}`)).data.ok === true);

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, RUN.length]);
const av = await api(PUT, `${V1}/avatars`, png);
check("上传头像", av.status === 200 && /^[0-9a-f]{24}$/.test(av.data.id), av.data);
const got = await fetch(`${server}${V1}/avatars/${av.data.id}`, { headers: { Authorization: `Bearer ${token}` } });
check("读取头像且永久缓存", got.status === 200 && (got.headers.get("Cache-Control") ?? "").includes("immutable") && (await got.arrayBuffer()).byteLength === png.length);

const agentId = writer.data.agent.keyId;
const rotated = await api(POST, `${V1}/chats/${enc(GROUP)}/agents/${agentId}/rotate`);
const newKey = rotated.data.key ?? "";
check("重新接入换 key", rotated.status === 200 && newKey && newKey !== writerKey, rotated.data);
check("旧 key 作废", (await api(POST, `${V1}/messages`, { text: "x" }, writerKey)).status === 401);
const viaNew = await api(POST, `${V1}/messages`, { text: "又来了" }, newKey);
check("新 key 可用", viaNew.data?.channel === GROUP, [viaNew.status, viaNew.data]);
const saved = await api(GET, `${V1}/chats/${enc(GROUP)}/agents/${rotated.data.agent.keyId}/prompt`);
check("查看的指令不含密钥", saved.data.prompt.includes("hxaioa guide --ack") && !saved.data.prompt.includes(newKey), saved.data);
const removed = await api(DELETE, `${V1}/chats/${enc(GROUP)}/agents/${rotated.data.agent.keyId}`);
check("移除 Agent 并作废 key", removed.data.ok === true && (await api(POST, `${V1}/messages`, { text: "x" }, newKey)).status === 401);
const read2 = await api(PATCH, `${V1}/chats/${enc(GROUP)}`, { read: 5 });
const read3 = await api(PATCH, `${V1}/chats/${enc(GROUP)}`, { read: 3 });
check("已读只前进", read2.data?.chat?.read === 5 && read3.data?.chat?.read === 5, [read2.status, read2.data, read3.data]);

const wipe = await api(DELETE, `${V1}/chats/${enc(GROUP)}/messages`);
const left = await api(GET, `${V1}/chats/${enc(GROUP)}/messages`);
const metaAfter = (await api(GET, `${V1}/chats`)).data.chats.find((m) => m.channel === GROUP);
check("清空聊天记录", wipe.status === 200 && wipe.data.deleted > 0 && left.data.messages.length === 0 && metaAfter?.cleared === wipe.data.cleared, [wipe.data, left.data, metaAfter]);

client.ws.close();
console.log(failed ? `${failed} 项失败` : "全部通过");
process.exit(failed ? 1 : 0);
