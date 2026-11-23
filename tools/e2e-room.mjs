#!/usr/bin/env node
// 多人群冒烟测试: 邀请链接注册进群, 成员只收自己群的消息, 发送者按 by 区分, 群里提醒别人,
// 成员撤回自己的 / 不能删别人的, 管理员能删, 踢人后收不到, 邀请过期与说明页。
// 环境变量: AIOA_SERVER, AIOA_TOKEN (AUTH_TOKEN); 服务端需要配置 TOKEN_SECRET
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const RUN = Date.now().toString(36);
const ROOM = `room-${RUN}`;
const SOLO = `solo-${RUN}`;
const WAIT_MS = 3000;
const QUIET_MS = 800;
const GET = "GET";
const POST = "POST";
const PATCH = "PATCH";
const DELETE = "DELETE";
const PASSWORD = "password-123";
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
  const next = async (test, wait = WAIT_MS) => {
    const end = Date.now() + wait;
    while (Date.now() < end) {
      const hit = frames.find(test);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };
  const open = new Promise((r) => (ws.onopen = r));
  return { ws, frames, next, open, send: (f) => ws.send(JSON.stringify(f)) };
}

const enc = encodeURIComponent;
const isEv = (cid) => (f) => f.t === "ev" && f.ev.cid === cid;

const owner = stream({ token, device: `android-o-${RUN}` });
await owner.open;
const ownerWelcome = await owner.next((f) => f.t === "welcome");

const inv = await api(POST, `${V1}/chats/${enc(ROOM)}/invites`, { ttlHours: 1, maxUses: 2 });
check("生成邀请链接", inv.status === 200 && inv.data.code?.startsWith("hxr_") && inv.data.link?.includes("/join/") && inv.data.appLink?.startsWith("hxaioa://"), inv.data);

const page = await fetch(inv.data.link.replace(/^https:\/\/[^/]+/, server));
check("说明页可打开", page.status === 200 && (await page.text()).includes("在 App 中打开"));

async function register(name) {
  const r = await fetch(`${server}${V1}/join`, {
    method: POST,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: inv.data.code, name, password: PASSWORD, display: name.toUpperCase() }),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const alice = await register(`alice${RUN}`);
check("用群邀请码注册即登录", alice.status === 200 && !!alice.data.access, alice.data);
const bob = await register(`bob${RUN}`);
check("第二人注册", bob.status === 200 && !!bob.data.access, bob.data);
const carol = await register(`carol${RUN}`);
check("邀请用满后失效", carol.status === 410, carol.data);

const A = alice.data.access;
const B = bob.data.access;
const aliceId = alice.data.user.id;
const bobId = bob.data.user.id;

const chats = await api(GET, `${V1}/chats`, undefined, A);
const mine = chats.data?.chats ?? [];
check("成员只看到自己的群", mine.length === 1 && mine[0].channel === ROOM && mine[0].role === "member" && mine[0].members === 3, chats.data);

const members = await api(GET, `${V1}/chats/${enc(ROOM)}/members`, undefined, A);
check("成员列表", members.status === 200 && members.data.members.some((m) => m.id === bobId), members.data);
check("成员不能看总览", (await api(GET, `${V1}/overview`, undefined, A)).status === 403);
check("成员不能读别的群", (await api(GET, `${V1}/chats/${enc(SOLO)}/messages?since=0`, undefined, A)).status === 403);

const sa = stream({ token: A, device: `android-a-${RUN}`, since: "0" });
const sb = stream({ token: B, device: `android-b-${RUN}`, since: "0" });
await Promise.all([sa.open, sb.open]);
const wa = await sa.next((f) => f.t === "welcome");
check("成员 welcome 带 uid", wa?.uid === aliceId, wa);

sa.send({ t: "send", cid: `a1-${RUN}`, body: { kind: "text", text: "大家好" }, channel: ROOM });
const a1b = (await sb.next(isEv(`a1-${RUN}`)))?.ev;
check("成员消息推给其他成员", !!a1b && a1b.by === aliceId && a1b.source.name === `ALICE${RUN}`.toUpperCase() && a1b.route?.action === "push", a1b);
check("主人也收到", !!(await owner.next(isEv(`a1-${RUN}`))));

owner.send({ t: "send", cid: `o1-${RUN}`, body: { kind: "text", text: "只有我" }, channel: SOLO });
check("自己的群不推给成员", !(await sb.next(isEv(`o1-${RUN}`), QUIET_MS)));
owner.send({ t: "send", cid: `o2-${RUN}`, body: { kind: "text", text: "群主说话" }, channel: ROOM });
const o2 = (await sa.next(isEv(`o2-${RUN}`)))?.ev;
check("群主的消息带 by", !!o2 && o2.by === ownerWelcome?.uid, { o2, uid: ownerWelcome?.uid });

sa.send({ t: "send", cid: `a2-${RUN}`, body: { kind: "text", text: "别的群" }, channel: SOLO });
check("成员不能往别的群发", !!(await sa.next((f) => f.t === "err" && f.code === "forbidden")));

const bobDel = await api(DELETE, `${V1}/events/seq/${a1b?.seq}?mode=delete`, undefined, B);
check("普通成员不能删别人的", bobDel.status === 403, bobDel.data);
const bobRecall = await api(DELETE, `${V1}/events/seq/${a1b?.seq}?mode=recall`, undefined, B);
check("不能撤回别人的", bobRecall.status === 403, bobRecall.data);
const aliceRecall = await api(DELETE, `${V1}/events/seq/${a1b?.seq}?mode=recall`, undefined, A);
check("成员撤回自己的", aliceRecall.status === 200 && aliceRecall.data.deleted?.mode === "recall" && aliceRecall.data.by === aliceId, aliceRecall.data);
check("撤回推给其他成员", !!(await sb.next((f) => f.t === "ev" && f.ev.deleted?.seq === a1b?.seq)));

const promote = await api(PATCH, `${V1}/chats/${enc(ROOM)}/members/${bobId}`, { role: "admin" });
check("群主设管理员", promote.status === 200, promote.data);
const bobDel2 = await api(DELETE, `${V1}/events/seq/${o2?.seq}?mode=delete`, undefined, B);
check("管理员删本群消息", bobDel2.status === 200 && bobDel2.data.deleted?.mode === "delete", bobDel2.data);
const aliceKickBob = await api(DELETE, `${V1}/chats/${enc(ROOM)}/members/${bobId}`, undefined, A);
check("成员不能踢管理员", aliceKickBob.status === 403, aliceKickBob.data);

const pref = await api(PATCH, `${V1}/chats/${enc(ROOM)}`, { pinned: true, title: "改不了" }, A);
check("成员置顶只影响自己, 不能改标题", pref.status === 200 && pref.data.chat.pinned === true && pref.data.chat.title !== "改不了", pref.data);

const page2 = await api(GET, `${V1}/chats/${enc(ROOM)}/messages?before=${Number.MAX_SAFE_INTEGER}&limit=10`, undefined, A);
check("成员翻历史", page2.status === 200 && page2.data.messages.length >= 2, page2.data);

const kick = await api(DELETE, `${V1}/chats/${enc(ROOM)}/members/${aliceId}`, undefined, B);
check("管理员踢成员", kick.status === 200, kick.data);
owner.send({ t: "send", cid: `o3-${RUN}`, body: { kind: "text", text: "踢了之后" }, channel: ROOM });
check("被踢后收不到", !(await sa.next(isEv(`o3-${RUN}`), QUIET_MS)));
check("被踢后读不到", (await api(GET, `${V1}/chats/${enc(ROOM)}/messages?since=0`, undefined, A)).status === 403);

const rejoin = await api(POST, `${V1}/rooms/join`, { code: inv.data.code }, A);
check("用满的邀请不能再进", rejoin.status === 410 || rejoin.status === 404, rejoin.data);

for (const s of [owner, sa, sb]) s.ws.close();
await api(DELETE, `${V1}/users/${aliceId}`);
await api(DELETE, `${V1}/users/${bobId}`);
await api(DELETE, `${V1}/chats/${enc(ROOM)}/messages`);
await api(DELETE, `${V1}/chats/${enc(SOLO)}/messages`);
console.log(failed ? `${failed} 项失败` : "全部通过");
process.exit(failed ? 1 : 0);
