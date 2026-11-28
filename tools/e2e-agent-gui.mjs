// Agent GUI 探针端到端 (#126): 起 probe-agent 模块 (不连 Hub, 注入 send), 用假 ACP Agent 跑一遍直连协议
// 用法: node tools/e2e-agent-gui.mjs   (不需要服务端; 最后一段用假 Hub 验证 probe.mjs 的接入)
import { spawn, execFileSync } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "./probe-agent.mjs";
import { startServer } from "./probe-agent-ws.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK = path.join(HERE, "fixtures", "mock-acp-agent.mjs");
const WAIT_MS = 8000;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const SIGN = { name: "ECDSA", hash: "SHA-256" };
const HX = "hx_res";
const PERM_REQ = "perm_req";
const PERM_DONE = "perm_done";
const PROMPT = "session/prompt";
const WINDOW = "window";
const ACP = "acp";
const ACP_OUT = "acp_out";
const SESSION = "session";
const ORIGIN = "https://aioa.example";
const AG_REQ = "ag_req";
const AG_UNREQ = "ag_unreq";
const AG_PAIR = "ag_pair";
const AG_INDEX = "ag_index";
const ATTACH = "attach";
const READY = "ready";
const RPC = "2.0";
const FILE_A = "a.txt";
const SETTINGS_SET = "settings/set";
const ALLOW = "allow";
const DESKTOP = "desktop";

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed += 1;
  else failures.push(`${name} ${detail}`);
  console.log(`${ok ? "通过" : "失败"}: ${name}${ok || !detail ? "" : ` (${detail})`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

async function device(name) {
  const keys = await webcrypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
  const pub = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
  const id = createHash("sha256").update(JSON.stringify({ crv: pub.crv, kty: pub.kty, x: pub.x, y: pub.y })).digest("hex").slice(0, 16);
  return { id, name, pub, priv: keys.privateKey };
}

class Client {
  constructor(url, dev, fg = true) {
    this.frames = [];
    this.waiters = [];
    this.n = 100;
    this.ws = new WebSocket(url);
    this.ws.onmessage = async (e) => {
      const data = JSON.parse(e.data);
      for (const f of Array.isArray(data) ? data : [data]) {
        if (f.t === "challenge" && dev) {
          const sig = await webcrypto.subtle.sign(SIGN, dev.priv, new TextEncoder().encode(f.nonce));
          this.ws.send(JSON.stringify({ t: "hello", device: dev.id, sig: Buffer.from(sig).toString("base64url"), fg }));
        }
        this.frames.push(f);
        this.waiters = this.waiters.filter((w) => !w(f));
      }
    };
    this.closed = new Promise((r) => (this.ws.onclose = r));
  }
  // 等一帧满足条件 (含已收到的, 从 from 位置往后找)
  wait(pred, from = 0, ms = WAIT_MS) {
    const hit = this.frames.slice(from).find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("等待超时")), ms);
      this.waiters.push((f) => (pred(f) ? (clearTimeout(t), resolve(f), true) : false));
    });
  }
  send(f) {
    this.ws.send(JSON.stringify(f));
  }
  async hx(m, p) {
    const id = ++this.n;
    this.send({ t: "hx", id, m, p });
    const r = await this.wait((f) => f.t === HX && f.id === id);
    if (!r.ok) throw new Error(r.err);
    return r.r;
  }
  mark() {
    return this.frames.length;
  }
  close() {
    this.ws.close();
    return this.closed;
  }
}

function gitRepo() {
  const dir = tmp("agui-cwd-");
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, FILE_A), "one\n");
  g("add", ".");
  g("-c", "user.email=e2e@x", "-c", "user.name=e2e", "commit", "-q", "-m", "init");
  fs.writeFileSync(path.join(dir, FILE_A), "one\ntwo\n");
  fs.mkdirSync(path.join(dir, "node_modules"));
  return dir;
}

async function main() {
  const home = tmp("agui-home-");
  const cwd = gitRepo();
  const hub = [];
  process.env.AIOA_TOKEN = "must-not-leak";
  const agent = await createAgent({ send: (f) => hub.push(f), subject: "pc", listen: "127.0.0.1:0", home });
  const base = `http://127.0.0.1:${agent.port}`;
  const wsUrl = `ws://127.0.0.1:${agent.port}/ws`;
  check("本地文件已生成", ["host-key.json", "devices.json", "instances.json", "settings.json", "rules.json"].every((f) => fs.existsSync(path.join(home, f))));
  check("host info 声明 agent", agent.info().v === 1 && agent.info().port === agent.port && agent.info().routes[0].kind === "local");

  let res = await fetch(`${base}/hello?n=abc`, { headers: { Origin: ORIGIN } });
  const hello = await res.json();
  check("/hello", hello.v === 1 && hello.host === "pc" && hello.pub?.kty === "EC" && hello.agent === "hx-aioa-agent" && !!hello.nonce);
  check("CORS 与私有网络头", res.headers.get("access-control-allow-origin") === ORIGIN && res.headers.get("access-control-allow-private-network") === "true");
  const hostKey = await webcrypto.subtle.importKey("jwk", hello.pub, ECDSA, false, ["verify"]);
  check("/hello?n 主机签名可验", await webcrypto.subtle.verify(SIGN, hostKey, Buffer.from(hello.nsig, "base64url"), new TextEncoder().encode("abc")));
  res = await fetch(`${base}/hello`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Private-Network": "true" } });
  check("OPTIONS 预检 204", res.status === 204 && res.headers.get("access-control-allow-private-network") === "true");

  const devA = await device("桌面");
  const devB = await device("手机");
  agent.handle({ t: AG_PAIR, pid: "p1", device: { id: devA.id, name: devA.name, pub: devA.pub } });
  agent.handle({ t: AG_PAIR, pid: "p2", device: { id: devB.id, name: devB.name, pub: devB.pub } });
  const paired = hub.find((f) => f.t === "ag_paired" && f.pid === "p1");
  check("ag_pair -> ag_paired", paired?.ok && paired.device.id === devA.id && paired.pub.x === hello.pub.x && paired.routes.length >= 1);
  agent.handle({ t: AG_PAIR, pid: "p3", device: { id: "bad", name: "x", pub: { kty: "EC" } } });
  check("坏公钥配对失败", hub.find((f) => f.pid === "p3")?.ok === false);

  const evil = await device("冒充");
  const bad = new Client(wsUrl, { ...evil, id: devA.id });
  const err = await bad.wait((f) => f.t === "error");
  check("签名错 -> auth 错误并关闭", err.code === "auth");
  await bad.closed;

  const A = new Client(wsUrl, devA, true);
  const ready = await A.wait((f) => f.t === READY);
  check("握手 ready", ready.device === devA.id && ready.host === "pc" && Array.isArray(ready.sessions) && ready.instances.length === 3 && ready.settings.watchPush === "quiet");
  const insts = await A.hx("instances/save", { id: "mock", name: "假 Agent", kind: "custom", cmd: process.execPath, args: [MOCK], env: { MOCK_ACP_TERMINAL: "1" } });
  check("instances/save", insts.some((i) => i.id === "mock"));

  const info = await A.hx("session/create", { instance: "mock", cwd, mode: "plan", model: "mock-2" });
  check("session/create", info.state === "idle" && info.agent === "假 Agent" && info.modes?.currentModeId === "plan" && !info.acpSid);
  check("子进程环境无 AIOA_TOKEN", info.caps?.agentInfo?._meta?.token === null, JSON.stringify(info.caps?.agentInfo));
  check("模型经 set_config_option 设置", info.caps?.configOptions?.[0]?.currentValue === "mock-2");
  const sid = info.id;

  const B = new Client(wsUrl, devB, false);
  await B.wait((f) => f.t === READY);
  A.send({ t: ATTACH, sid });
  B.send({ t: ATTACH, sid });
  await A.wait((f) => f.t === WINDOW && f.sid === sid);
  await B.wait((f) => f.t === WINDOW && f.sid === sid);

  let a0 = A.mark();
  let b0 = B.mark();
  A.send({ t: ACP_OUT, sid, m: { jsonrpc: RPC, id: 7, method: PROMPT, params: { sessionId: "whatever", prompt: [{ type: "text", text: "帮我跑测试\n第二行\n第三行" }] } } });
  const echoA = await A.wait((f) => f.t === ACP && f.m.method === PROMPT, a0);
  const echoB = await B.wait((f) => f.t === ACP && f.m.method === PROMPT, b0);
  check("prompt 回显: 发起端 id 还原, 他端为探针 id", echoA.m.id === 7 && typeof echoB.m.id === "string" && echoB.m.params.sessionId === "mock-session-1");
  const reqA = await A.wait((f) => f.t === PERM_REQ, a0);
  const reqB = await B.wait((f) => f.t === PERM_REQ, b0);
  const card = reqA.card;
  check("两端都收到 perm_req", reqA.rid === reqB.rid);
  check("卡片四问", card.tool.kind === "execute" && card.tool.content.includes("rm -rf build") && card.goal === "帮我跑测试\n第二行" && card.last.includes("测试。") && card.options.length === 3 && card.host === "pc" && card.branch === "main");
  check("风险档 high (rm)", card.risk === "high" && card.why.includes("rm 删除"), JSON.stringify(card.why));
  check("acp 流里也有原文 request_permission", A.frames.slice(a0).some((f) => f.t === ACP && f.m.method === "session/request_permission"));
  const ag = hub.find((f) => f.t === AG_REQ && f.card.rid === card.rid);
  check("ag_req quiet=true (有前台附着)", ag?.card.quiet === true);
  const st = await A.wait((f) => f.t === SESSION && f.info.id === sid && f.info.state === "waiting", a0);
  check("会话状态 waiting", st.info.pending === 1);

  B.send({ t: "perm", sid, rid: card.rid, option: ALLOW });
  const doneB = await B.wait((f) => f.t === PERM_DONE && f.rid === card.rid, b0);
  A.send({ t: "perm", sid, rid: card.rid, option: "reject" });
  const doneA = await A.wait((f) => f.t === PERM_DONE && f.rid === card.rid, a0);
  check("先答先得", doneB.by === DESKTOP && doneB.option === ALLOW && doneA.option === ALLOW);
  check("ag_unreq by desktop", hub.some((f) => f.t === AG_UNREQ && f.rid === card.rid && f.by === DESKTOP));
  const resA = await A.wait((f) => f.t === ACP && f.m.id === 7 && f.m.result, a0);
  check("prompt 回包 id 还原", resA.m.result.stopReason === "end_turn");
  await A.wait((f) => f.t === SESSION && f.info.id === sid && f.info.state === "idle", a0);
  const stats = await A.wait((f) => f.t === "stats" && f.sid === sid && f.hit !== undefined, a0, 3000);
  check("stats", stats.ctx?.[0] === 53000 && stats.ctx[1] === 200000 && stats.hit === 0.72 && stats.cost === 0.045 && stats.out === 120 && stats.tps > 0, JSON.stringify(stats));
  check("会话 ctx 占比", A.frames.some((f) => f.t === SESSION && f.info.ctx === 0.265));
  check("标题自动取自首条 prompt", A.frames.slice(a0).some((f) => f.t === SESSION && f.info.title === "帮我跑测试"));
  await sleep(1200);
  const calib = JSON.parse(fs.readFileSync(path.join(home, "calib.json"), "utf8"));
  check("tok/s 校准系数按 实例/模型 落盘", calib["mock/mock-2"] > 0, JSON.stringify(calib));

  const out = await A.hx("tool/output", { sid, toolCallId: "tc1" });
  check("tool/output 完整输出 + 终端", JSON.stringify(out.content).includes("测试通过") && JSON.stringify(out).length > 2048, JSON.stringify(out).slice(0, 200));
  const C = new Client(wsUrl, devA, false);
  await C.wait((f) => f.t === READY);
  C.send({ t: ATTACH, sid });
  const win = await C.wait((f) => f.t === WINDOW && f.sid === sid);
  const cut = win.items.find((i) => i.cut);
  check("回放窗口 (含 prompt, 工具大输出已裁掉)", win.from === 1 && win.more === false && win.items.some((i) => i.m.method === PROMPT) && !!cut && !JSON.stringify(cut).includes("测试通过 测试通过"));
  check("窗口无 hx 私有字段", win.items.every((i) => typeof i.seq === "number" && i.m.jsonrpc === RPC));

  // 断线补帧: A 断开, B 发第二轮, Hub 答复, A 以 since 重连
  const lastSeq = Math.max(...A.frames.filter((f) => f.t === ACP).map((f) => f.seq));
  await A.close();
  b0 = B.mark();
  B.send({ t: ACP_OUT, sid, m: { jsonrpc: RPC, id: 1, method: PROMPT, params: { prompt: [{ type: "text", text: "写文件吧" }] } } });
  const req2 = await B.wait((f) => f.t === PERM_REQ, b0);
  check("无前台附着 -> ag_req quiet=false", hub.find((f) => f.t === AG_REQ && f.card.rid === req2.rid)?.card.quiet === false);
  agent.handle({ t: "ag_answer", aid: "a_1", sid, rid: req2.rid, option: ALLOW });
  const done2 = await B.wait((f) => f.t === PERM_DONE && f.rid === req2.rid, b0);
  check("Hub 答复 -> perm_done by hub", done2.by === "hub");
  check("Hub 答复不回 ag_unreq", !hub.some((f) => f.t === AG_UNREQ && f.rid === req2.rid));
  agent.handle({ t: "ag_answer", aid: "a_2", sid, rid: card.rid, option: ALLOW });
  check("Hub 晚答 -> ag_unreq by desktop", hub.some((f) => f.t === AG_UNREQ && f.rid === card.rid && f.by === DESKTOP && hub.indexOf(f) > hub.findIndex((x) => x.t === AG_REQ && x.card.rid === req2.rid)));
  await B.wait((f) => f.t === ACP && f.m.id === 1 && f.m.result, b0);
  check("fs/write_text_file 落在 cwd", fs.readFileSync(path.join(cwd, "mock-out.txt"), "utf8") === "hello");
  const A2 = new Client(wsUrl, devA, true);
  await A2.wait((f) => f.t === READY);
  A2.send({ t: ATTACH, sid, since: lastSeq });
  const w2 = await A2.wait((f) => f.t === WINDOW);
  const seqs = w2.items.map((i) => i.seq);
  check("since 补帧连续", w2.from === lastSeq + 1 && seqs[0] === lastSeq + 1 && seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1) && w2.to === seqs.at(-1), `${w2.from} ${seqs[0]} ${w2.to}`);

  const gs = await A2.hx("git/status", { sid });
  check("git/status", gs.branch === "main" && gs.files.some((f) => f.path === FILE_A && f.y === "M" && f.add === 1) && gs.files.some((f) => f.path === "mock-out.txt" && f.x === "?"), JSON.stringify(gs));
  const gd = await A2.hx("git/diff", { sid, path: FILE_A });
  check("git/diff", gd.diff.includes("+two"));
  const gu = await A2.hx("git/diff", { sid, path: "mock-out.txt" });
  check("git/diff 未跟踪文件", gu.diff.includes("+hello"));
  const tree = await A2.hx("fs/tree", { sid });
  check("fs/tree (跳过 .git node_modules)", tree.entries.some((e) => e.name === FILE_A && !e.dir) && !tree.entries.some((e) => e.name === ".git" || e.name === "node_modules"));
  const rd = await A2.hx("fs/read", { sid, path: FILE_A });
  check("fs/read", rd.text === "one\ntwo\n" && rd.truncated === false);
  const esc = await A2.hx("fs/read", { sid, path: "../../etc/passwd" }).catch((e) => e.message);
  check("fs/read 不许出 cwd", String(esc).includes("不在会话目录内"));

  const a2m = A2.mark();
  const pg = await A2.hx("log/page", { sid, before: lastSeq + 1, limit: 1 });
  const pw = await A2.wait((f) => f.t === WINDOW && f.to === lastSeq, a2m);
  check("log/page 按轮往前翻", pg.to === lastSeq && pw.items[0].m.method === PROMPT && pg.more === true, JSON.stringify(pg));
  check(SETTINGS_SET, (await A2.hx(SETTINGS_SET, { watchPush: "normal" })).watchPush === "normal");
  check("settings 校验", String(await A2.hx(SETTINGS_SET, { watchPush: "loud" }).catch((e) => e.message)).includes("watchPush"));
  check("devices/list", (await A2.hx("devices/list", {})).length === 2);
  check("dirs/recent", (await A2.hx("dirs/recent", {})).dirs[0] === cwd);
  check("session/rename", (await A2.hx("session/rename", { sid, title: "新标题" })).title === "新标题");

  let m2 = A2.mark();
  A2.send({ t: ACP_OUT, sid, m: { jsonrpc: RPC, id: 9, method: "session/set_mode", params: { modeId: "default" } } });
  await A2.wait((f) => f.t === ACP && f.m.id === 9, m2);
  check("set_mode 透传", (await A2.wait((f) => f.t === SESSION && f.info.modes?.currentModeId === "default", m2)).info.id === sid);

  check("settings 静默重推间隔", (await A2.hx(SETTINGS_SET, { watchPush: "quiet", quietRepushSec: 5 })).quietRepushSec === 5);
  // 拒绝并说明: 拒绝后取消当前轮, 再把说明作为下一轮 prompt
  m2 = A2.mark();
  A2.send({ t: ACP_OUT, sid, m: { jsonrpc: RPC, id: 10, method: PROMPT, params: { prompt: [{ type: "text", text: "第三轮" }] } } });
  const req3 = await A2.wait((f) => f.t === PERM_REQ, m2);
  const reqs3 = () => hub.filter((f) => f.t === AG_REQ && f.card.rid === req3.rid).map((f) => f.card.quiet);
  check("静默推送", reqs3().join() === "true");
  await sleep(5300);
  check("静默 5 秒没人答 -> quiet:false 重发同一 rid", reqs3().join() === "true,false", reqs3().join());
  A2.send({ t: "perm", sid, rid: req3.rid, option: null, text: "别删, 换个办法" });
  const d3 = await A2.wait((f) => f.t === PERM_DONE && f.rid === req3.rid, m2);
  check("拒绝 = reject_once", d3.option === "reject");
  const req4 = await A2.wait((f) => f.t === PERM_REQ && f.rid !== req3.rid, m2);
  check("说明作为下一条 prompt", req4.card.goal === "别删, 换个办法");
  m2 = A2.mark();
  await A2.hx("session/close", { sid });
  const d4 = await A2.wait((f) => f.t === PERM_DONE && f.rid === req4.rid, m2);
  check("关闭时未决请求以 cancelled 收尾", d4.by === "agent" && d4.option === null);
  check("ag_unreq by agent", hub.some((f) => f.t === AG_UNREQ && f.rid === req4.rid && f.by === "agent"));
  await A2.wait((f) => f.t === SESSION && f.info.state === "closed", m2);

  const before = fs.readFileSync(path.join(home, "sessions", `${sid}.jsonl`), "utf8");
  const rs = await A2.hx("session/resume", { sid });
  check("session/resume (loadSession)", rs.state === "idle");
  const after = fs.readFileSync(path.join(home, "sessions", `${sid}.jsonl`), "utf8");
  check("load 回放的通知不重复记", !after.slice(before.length).includes("回放的旧消息"));
  const turns = JSON.parse(fs.readFileSync(path.join(home, "sessions", `${sid}.turns.json`), "utf8"));
  check("轮索引", turns.length === 4 && turns.every((t) => typeof t.off === "number"), JSON.stringify(turns));

  hub.length = 0;
  agent.onConnect();
  const idx = hub.find((f) => f.t === AG_INDEX);
  check(AG_INDEX, idx?.sessions[0]?.id === sid && idx.sessions[0].title === "新标题" && !("cwd" in idx.sessions[0]));
  await A2.hx("session/delete", { sid });
  check("session/delete 删日志", !fs.existsSync(path.join(home, "sessions", `${sid}.jsonl`)));
  check("devices/remove 断开该设备连接", (await A2.hx("devices/remove", { id: devB.id })).length === 1 && (await Promise.race([B.closed.then(() => true), sleep(2000).then(() => false)])));

  await Promise.all([A2.close(), C.close()]);
  agent.close();
  await probeIntegration();
}

// probe.mjs 接入: 假 Hub 收 host 帧 (带 agent), 发 ag_pair 收 ag_paired
async function probeIntegration() {
  const frames = [];
  let hubWs;
  const hubServer = await startServer({ host: "127.0.0.1", port: 0, routes: {}, onSocket: (ws) => {
    hubWs = ws;
    ws.on("message", (t) => t !== "ping" && frames.push(JSON.parse(t)));
  } });
  const home = tmp("agui-probe-");
  const child = spawn(process.execPath, [path.join(HERE, "probe.mjs")], {
    env: { ...process.env, AIOA_SERVER: `http://127.0.0.1:${hubServer.address().port}`, AIOA_TOKEN: "k", AIOA_SUBJECT: "nas", AIOA_AGENT: "1", AIOA_AGENT_HOME: home, AIOA_AGENT_LISTEN: "127.0.0.1:0" },
    stdio: "ignore",
  });
  const until = async (pred) => {
    for (let i = 0; i < 80; i++) {
      const f = frames.find(pred);
      if (f) return f;
      await sleep(100);
    }
    return undefined;
  };
  const host = await until((f) => f.t === "host");
  check("probe.mjs host info 带 agent", host?.info.agent?.v === 1 && host.info.agent.port > 0 && host.info.agent.routes?.[0]?.kind === "local", JSON.stringify(host?.info));
  check("probe.mjs 连上即报 ag_index", !!(await until((f) => f.t === AG_INDEX)));
  const dev = await device("x");
  hubWs?.send(JSON.stringify({ t: AG_PAIR, pid: "pp", device: { id: dev.id, name: "x", pub: dev.pub } }));
  check("probe.mjs 转 ag_pair -> ag_paired", (await until((f) => f.t === "ag_paired"))?.ok === true);
  child.kill();
  hubServer.close();
}

main()
  .catch((e) => failures.push(`异常: ${e.stack}`))
  .finally(() => {
    console.log(`\n${passed} 项通过, ${failures.length} 项失败`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(failures.length ? 1 : 0);
  });
