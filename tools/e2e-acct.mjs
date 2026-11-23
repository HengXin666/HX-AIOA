// 多账号端到端: 初始化母号, 登录刷新, 邀请加入, 批准, 数据隔离, 踢下线, 删号
// 用法: AIOA_SERVER=http://127.0.0.1:8787 AIOA_TOKEN=<AUTH_TOKEN> AIOA_SETUP_CODE=<SETUP_CODE> node tools/e2e-acct.mjs
const SERVER = process.env.AIOA_SERVER;
const LEGACY = process.env.AIOA_TOKEN;
const CODE = process.env.AIOA_SETUP_CODE;
if (!SERVER || !LEGACY || !CODE) {
  console.error("需要环境变量 AIOA_SERVER, AIOA_TOKEN, AIOA_SETUP_CODE");
  process.exit(2);
}
const V1 = "/api/v1";
const POST = "POST";
const GET = "GET";
const PASS = "password-123";
const OWNER = "hengxin";

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed += 1;
  else failures.push(`${name} ${detail}`);
  console.log(`${ok ? "通过" : "失败"}: ${name}`);
}

async function call(method, path, token, body) {
  const res = await fetch(SERVER + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const dev = (name) => ({ name, platform: "e2e" });

let r = await call(GET, `${V1}/setup`);
check("初始化前 done=false", r.status === 200 && r.body.done === false, JSON.stringify(r.body));
r = await call(POST, `${V1}/setup`, null, { code: "wrong", name: OWNER, password: PASS });
check("错误口令 403", r.status === 403);
r = await call(POST, `${V1}/setup`, null, { code: CODE, name: OWNER, password: PASS, display: "HengXin", device: dev("pc") });
check("初始化母号", r.status === 200 && r.body.user?.role === "owner" && r.body.access?.startsWith("hxa_"), JSON.stringify(r.body));
const owner = r.body;
r = await call(POST, `${V1}/setup`, null, { code: CODE, name: "again", password: PASS });
check("重复初始化 409", r.status === 409);

r = await call(POST, `${V1}/auth/login`, null, { name: OWNER, password: "bad-password" });
check("错误密码 401", r.status === 401);
r = await call(POST, `${V1}/auth/login`, null, { name: OWNER, password: PASS, device: dev("phone") });
check("母号登录", r.status === 200);
const ownerPhone = r.body;

r = await call(POST, `${V1}/messages`, owner.access, { text: "母号的消息" });
check("母号用访问令牌发消息", r.status === 200, JSON.stringify(r.body));
r = await call(GET, `${V1}/events?since=0`, LEGACY);
const legacyCount = r.body?.events?.length ?? -1;
check("旧 AUTH_TOKEN 仍能读母号收件箱", r.status === 200 && legacyCount >= 1);

r = await call(POST, `${V1}/auth/refresh`, null, { refresh: owner.refresh });
check("刷新令牌", r.status === 200 && r.body.refresh !== owner.refresh);
const refreshed = r.body;
r = await call(POST, `${V1}/auth/refresh`, null, { refresh: owner.refresh });
check("旧刷新令牌失效", r.status === 401);

r = await call(POST, `${V1}/groups`, refreshed.access, { name: "family", title: "家人" });
check("建群组", r.status === 200);
r = await call(POST, `${V1}/invites`, refreshed.access, { role: "member", groups: ["family"], needsApproval: true });
check("建邀请 (需批准)", r.status === 200 && r.body.code?.startsWith("hxi_"));
const invite = r.body;
r = await call(POST, `${V1}/join`, null, { code: invite.code, name: "mom", password: PASS, display: "妈妈" });
check("加入后等待批准", r.status === 200 && r.body.pending === true);
const momId = r.body.user?.id;
r = await call(POST, `${V1}/join`, null, { code: invite.code, name: "mom2", password: PASS });
check("邀请码一次性", r.status === 404);
r = await call(POST, `${V1}/auth/login`, null, { name: "mom", password: PASS });
check("未批准不能登录", r.status === 403);
r = await call(POST, `${V1}/users/${momId}/approve`, refreshed.access);
check("批准", r.status === 200 && r.body.status === "active");
r = await call(POST, `${V1}/auth/login`, null, { name: "mom", password: PASS, device: dev("mom-phone") });
check("子号登录", r.status === 200 && r.body.user.role === "member");
const mom = r.body;

// 子号与母号共用一个库, 只能进自己所在的多人群 (见 e2e-room), 母号的收件箱一律 403
r = await call(GET, `${V1}/events?since=0`, mom.access);
check("子号读不到母号收件箱", r.status === 403, JSON.stringify(r.body));
r = await call(POST, `${V1}/messages`, mom.access, { text: "妈妈的备忘" });
check("子号不能直接写收件箱", r.status === 403);
r = await call(GET, `${V1}/chats`, mom.access);
check("子号的群列表为空", r.status === 200 && r.body.chats.length === 0, JSON.stringify(r.body));
r = await call(GET, `${V1}/events?since=0`, LEGACY);
check("母号收件箱不变", (r.body?.events?.length ?? -1) === legacyCount);
r = await call(GET, `${V1}/users`, mom.access);
check("子号不能列用户", r.status === 403);
r = await call(POST, `${V1}/keys`, mom.access, { name: "x", scopes: ["events:write"] });
check("子号暂不能建 key", r.status === 403);
r = await call(GET, `${V1}/me`, mom.access);
check("我: 群组与设备", r.status === 200 && r.body.groups.length === 1 && r.body.devices.length === 1);

r = await call(GET, `${V1}/me`, ownerPhone.access);
const phoneSession = ownerPhone.session;
r = await call("DELETE", `${V1}/me/devices/${phoneSession}`, refreshed.access);
check("吊销设备", r.status === 200);
r = await call(GET, `${V1}/me`, ownerPhone.access);
check("被吊销的访问令牌立即失效", r.status === 401);

r = await call("PATCH", `${V1}/users/${momId}`, refreshed.access, { status: "disabled" });
check("禁用子号", r.status === 200);
r = await call(GET, `${V1}/me`, mom.access);
check("禁用后令牌失效", r.status === 401);
r = await call("DELETE", `${V1}/users/${momId}`, refreshed.access);
check("删号", r.status === 200);
r = await call(GET, `${V1}/audit`, refreshed.access);
check("审计日志", r.status === 200 && r.body.entries.length >= 5);
r = await call(GET, `${V1}/setup`);
check("初始化后 done=true", r.body?.done === true);

console.log(`\n${passed} 通过, ${failures.length} 失败`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
