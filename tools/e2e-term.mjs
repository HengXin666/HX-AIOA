// 终端端到端: 添加主机 (带终端) → 探针连上 → 密码换票据 → 开会话执行命令 → 关闭; 再验证没权限的 key 不能开
// 用法: AIOA_SERVER=http://127.0.0.1:8799 AIOA_SETUP_CODE=<SETUP_CODE> node tools/e2e-term.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = process.env.AIOA_SERVER;
const CODE = process.env.AIOA_SETUP_CODE;
if (!SERVER || !CODE) {
  console.error("需要环境变量 AIOA_SERVER, AIOA_SETUP_CODE");
  process.exit(2);
}
const V1 = "/api/v1";
const POST = "POST";
const OWNER = "termowner";
const PASS = "password-123";
const WAIT_MS = 15_000;
const PROBE = fileURLToPath(new URL("./probe.mjs", import.meta.url));

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

function probe(subject, key, shell) {
  return spawn(process.execPath, [PROBE], {
    env: { ...process.env, AIOA_SERVER: SERVER, AIOA_TOKEN: key, AIOA_SUBJECT: subject, AIOA_SHELL: shell ? "1" : "0" },
    stdio: "ignore",
  });
}

// 一条客户端长连接, 收到的帧排队, waitFor 按条件取
function client(token) {
  const url = new URL("/ws", SERVER.replace(/^http/, "ws"));
  url.searchParams.set("token", token);
  url.searchParams.set("device", "e2e-term");
  const ws = new WebSocket(url);
  const frames = [];
  const waiters = [];
  ws.onmessage = (e) => {
    if (e.data === "pong") return;
    const f = JSON.parse(e.data);
    frames.push(f);
    for (const w of [...waiters]) if (w.pred(f)) w.done(f);
  };
  const waitFor = (pred) =>
    new Promise((resolve) => {
      const hit = frames.find(pred);
      if (hit) return resolve(hit);
      const w = { pred, done: (f) => (waiters.splice(waiters.indexOf(w), 1), clearTimeout(w.t), resolve(f)) };
      w.t = setTimeout(() => (waiters.splice(waiters.indexOf(w), 1), resolve(null)), WAIT_MS);
      waiters.push(w);
    });
  return { ws, frames, waitFor, open: new Promise((r) => (ws.onopen = r)), send: (f) => ws.send(JSON.stringify(f)) };
}

let r = await call(POST, `${V1}/setup`, null, { code: CODE, name: OWNER, password: PASS, device: { name: "e2e", platform: "e2e" } });
if (r.status !== 200) r = await call(POST, `${V1}/auth/login`, null, { name: OWNER, password: PASS, device: { name: "e2e", platform: "e2e" } });
check("母号登录", r.status === 200, JSON.stringify(r.body));
const access = r.body.access;

r = await call(POST, `${V1}/probes`, access, { name: "Bad Name" });
check("主机名校验", r.status === 400);
r = await call(POST, `${V1}/probes`, access, { name: "e2e-shell", shell: true });
check("添加主机 (带终端)", r.status === 200 && r.body.command.includes("--shell") && r.body.command.includes("install.sh"), JSON.stringify(r.body));
const shellKey = r.body.key;
r = await call(POST, `${V1}/probes`, access, { name: "e2e-plain" });
check("添加主机 (不带终端)", r.status === 200 && !r.body.command.includes("--shell"));
const plainKey = r.body.key;

const c = client(access);
await c.open;
c.send({ t: "watch", subjects: ["e2e-shell", "e2e-plain"] });
// 不带 probe:shell 的 key, 即使探针本地开了终端, 卡片也不显示终端
const procs = [probe("e2e-shell", shellKey, true), probe("e2e-plain", plainKey, true)];
const hosts = await c.waitFor((f) => f.t === "hosts" && f.hosts.filter((h) => h.online).length === 2);
const byName = Object.fromEntries((hosts?.hosts ?? []).map((h) => [h.subject, h]));
check("有权限的主机卡片带 shell", byName["e2e-shell"]?.info.shell === true, JSON.stringify(hosts));
check("没权限的主机卡片不带 shell", byName["e2e-plain"] && !byName["e2e-plain"].info.shell);

r = await call(POST, `${V1}/shell/ticket`, access, { subject: "e2e-shell", password: "wrong-pass" });
check("密码错误拿不到票据", r.status === 403);
r = await call(POST, `${V1}/shell/ticket`, access, { subject: "e2e-plain", password: PASS });
check("没权限的主机拿不到票据", r.status === 409);
r = await call(POST, `${V1}/shell/ticket`, access, { subject: "e2e-shell", password: PASS });
check("密码正确拿到票据", r.status === 200 && typeof r.body.ticket === "string");
const ticket = r.body.ticket;

c.send({ t: "term_open", sid: "bad", subject: "e2e-shell", ticket: `${ticket}x`, cols: 80, rows: 24 });
check("伪造票据被拒", (await c.waitFor((f) => f.t === "term_close" && f.sid === "bad")) !== null);
c.send({ t: "term_open", sid: "s1", subject: "e2e-plain", ticket, cols: 80, rows: 24 });
check("票据不能换主机", (await c.waitFor((f) => f.t === "term_close" && f.sid === "s1")) !== null);

c.send({ t: "term_open", sid: "s2", subject: "e2e-shell", ticket, cols: 100, rows: 30 });
check("会话就绪", (await c.waitFor((f) => f.t === "term_ready" && f.sid === "s2")) !== null);
c.send({ t: "term", sid: "s2", d: Buffer.from("echo hi-$((40+2)); stty size\n").toString("base64") });
const out = () => c.frames.filter((f) => f.t === "term" && f.sid === "s2").map((f) => Buffer.from(f.d, "base64").toString()).join("");
await c.waitFor((f) => f.t === "term" && out().includes("hi-42") && out().includes("30 100"));
check("执行命令并回显", out().includes("hi-42"), out().slice(-200));
check("初始窗口大小生效", out().includes("30 100"));
c.send({ t: "term_resize", sid: "s2", cols: 120, rows: 40 });
c.send({ t: "term", sid: "s2", d: Buffer.from("stty size\n").toString("base64") });
await c.waitFor(() => out().includes("40 120"));
check("调整窗口大小", out().includes("40 120"));
c.send({ t: "term", sid: "s2", d: Buffer.from("exit\n").toString("base64") });
check("退出 shell 后会话关闭", (await c.waitFor((f) => f.t === "term_close" && f.sid === "s2")) !== null);
c.send({ t: "term", sid: "s2", d: "eA==" });
check("关闭后不能再写", (await c.waitFor((f) => f.t === "term_close" && f.sid === "s2" && f.reason === "会话不存在")) !== null);

r = await call("GET", `${V1}/cf/usage`, access);
check("CF 额度未配置时返回 configured=false", r.status === 200 && r.body.configured === false, JSON.stringify(r.body));

c.ws.close();
for (const p of procs) p.kill();
console.log(`\n${passed} 项通过, ${failures.length} 项失败`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
