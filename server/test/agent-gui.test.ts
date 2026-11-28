import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { AG_DONE_TTL_MS, AG_MAX_TOOL_CONTENT, AG_OPEN_TTL_MS, PATH_AGENT_GUI_INBOX, PATH_AGENT_GUI_PAIR, PATH_PROBE_SCOPE, agCtxBand, parseAgHostInfo, parseClientFrame, type AgCard, type HostCard, type WebPushPayload } from "@hx-aioa/protocol";
import { AgentGui, pushOf } from "../src/agent-gui";
import { AgentGuiStore } from "../src/agent-gui-store";
import { AGENT_GUI_ROUTES } from "../src/api-agent-gui";
import { PROBE_ROUTES, resetPasswordFailures } from "../src/api-probes";
import { Registry } from "../src/registry";
import { PROTO_V1 } from "../src/constants";
import type { Core, Principal } from "../src/core";
import { MetricRouter } from "../src/metrics";
import type { Attachment } from "../src/sockets";
import { OWNER_UID, call, memberWho, user } from "./chat-core";
import { memSql } from "./sql";

type Frame = Record<string, unknown>;
type Fake = WebSocket & { frames: Frame[]; a: Attachment; closed?: number };
const PUB = { kty: "EC", crv: "P-256", x: "abc", y: "def" };
const ROUTES = [{ kind: "local", url: "http://127.0.0.1:7841" }];
const PASSWORD = "pw";

const card = (over: Partial<AgCard> = {}): AgCard => ({
  rid: "r1",
  sid: "s1",
  host: "pc",
  agent: "claude",
  title: "修 bug",
  cwd: "/repo/app",
  at: 1,
  tool: { kind: "execute", title: "npm test", content: "npm test", locations: [] },
  goal: "跑测试",
  last: "我来跑一下",
  risk: "low",
  why: [],
  changed: 0,
  options: [
    { optionId: "allow", kind: "allow_once", name: "允许一次" },
    { optionId: "reject", kind: "reject_once", name: "拒绝" },
  ],
  ...over,
});

function setup() {
  const wss: Fake[] = [];
  const toClients: Frame[] = [];
  const pushes: { p: WebPushPayload; urgent: boolean }[] = [];
  const store = new AgentGuiStore(memSql());
  const hostCards = (): HostCard[] => wss.filter((w) => w.a.role === "probe" && w.a.host).map((w) => w.a.host!);
  const gui = new AgentGui({ all: () => wss, toClients: (f) => void toClients.push(f as Frame), store, push: async (p, urgent) => void pushes.push({ p, urgent }), hostCards });
  const connect = (att: Partial<Attachment>, onSend?: (f: Frame, ws: Fake) => void): Fake => {
    const ws = {
      frames: [],
      a: { device: `d${wss.length}`, proto: PROTO_V1, role: "client", ...att } as Attachment,
      deserializeAttachment: () => ws.a,
      serializeAttachment: (x: Attachment) => void (ws.a = x),
      close(code: number) {
        ws.closed = code;
      },
      send(t: string) {
        const f = JSON.parse(t) as Frame;
        ws.frames.push(f);
        onSend?.(f, ws);
      },
    } as unknown as Fake;
    wss.push(ws);
    return ws;
  };
  const probe = (subject = "pc", scoped = true, onSend?: (f: Frame, ws: Fake) => void) =>
    connect({ role: "probe", device: `probe-${subject}`, agent: scoped, host: { subject, online: true, seen: 1, info: { agent: { port: 7841, v: 1, routes: ROUTES as never } } } }, onSend);
  const frame = (o: Frame) => {
    const f = parseClientFrame(JSON.stringify(o));
    assert.ok(f, `帧应合法: ${JSON.stringify(o)}`);
    return f as never;
  };
  return { gui, store, wss, toClients, pushes, connect, probe, frame };
}

beforeEach(() => resetPasswordFailures());

test("ag 帧校验: 限长, 枚举, 私钥, 路线条数", () => {
  const long = card({ tool: { kind: "execute", title: "t", content: "x".repeat(AG_MAX_TOOL_CONTENT + 100), locations: [] } });
  const f = parseClientFrame(JSON.stringify({ t: "ag_req", card: long })) as { card: AgCard };
  assert.equal(f.card.tool.content.length, AG_MAX_TOOL_CONTENT);
  assert.equal(parseClientFrame(JSON.stringify({ t: "ag_req", card: { ...card(), risk: "extreme" } })), null);
  assert.equal(parseClientFrame(JSON.stringify({ t: "ag_req", card: { ...card(), rid: "" } })), null);
  assert.equal(parseClientFrame(JSON.stringify({ t: "ag_index", sessions: [{ id: "s1", state: "bogus" }] })), null);
  assert.deepEqual(parseClientFrame(JSON.stringify({ t: "ag_index", sessions: [{ id: "s1", agent: "c", title: "x", state: "running", pending: 1, updated: 2, ctx: 0.5 }] })), {
    t: "ag_index",
    sessions: [{ id: "s1", agent: "c", title: "x", state: "running", pending: 1, updated: 2, ctx: 0.5 }],
  });
  assert.equal(parseClientFrame(JSON.stringify({ t: "ag_unreq", sid: "s1", rid: "r1", by: "phone" })), null);
  assert.equal(parseClientFrame(JSON.stringify({ t: "ag_answer", aid: "a", host: "pc", sid: "s1", rid: "r1", option: "allow", text: "x".repeat(5000) })), null);
  assert.deepEqual(parseClientFrame(JSON.stringify({ t: "ag_answer", aid: "a", host: "pc", sid: "s1", rid: "r1", option: null })), { t: "ag_answer", aid: "a", host: "pc", sid: "s1", rid: "r1", option: null, text: "" });
  const paired = { t: "ag_paired", pid: "p1", ok: true, device: { id: "d1", name: "n", pub: { ...PUB, d: "secret" }, added: 1 }, pub: PUB, routes: ROUTES };
  assert.equal(parseClientFrame(JSON.stringify(paired)), null);
  const host = (agent: unknown) => parseClientFrame(JSON.stringify({ t: "host", subject: "pc", info: { agent } })) as { info: { agent?: unknown } };
  assert.deepEqual(host({ port: 7841, v: 1, routes: ROUTES }).info.agent, { port: 7841, v: 1, routes: ROUTES });
  assert.equal(host({ port: 7841, v: 1, routes: Array(5).fill(ROUTES[0]) }).info.agent, undefined);
  assert.equal(host({ port: 7841, v: 1, routes: [{ kind: "lan", url: "ftp://x" }] }).info.agent, undefined);
});

test("主机卡片: key 没有 probe:agent 时去掉 agent 声明", () => {
  const sql = memSql();
  const ws = { a: { device: "probe-pc", proto: PROTO_V1, role: "probe" } as Attachment, deserializeAttachment: () => ws.a, serializeAttachment: (x: Attachment) => void (ws.a = x) };
  const metrics = new MetricRouter(() => [ws as unknown as WebSocket], sql);
  const info = { agent: { port: 1, v: 1, routes: [] } };
  metrics.host(ws as unknown as WebSocket, ws.a, { t: "host", subject: "pc", info });
  assert.deepEqual(ws.a.host?.info.agent, { port: 1, v: 1, routes: [], denied: "scope" });
  metrics.host(ws as unknown as WebSocket, { ...ws.a, agent: true }, { t: "host", subject: "pc", info });
  assert.deepEqual(ws.a.host?.info.agent, info.agent);
  // 有 scope 的探针自报 denied: 当没声明
  metrics.host(ws as unknown as WebSocket, { ...ws.a, agent: true }, { t: "host", subject: "pc", info: { agent: { ...info.agent, denied: "scope" } } });
  assert.equal(ws.a.host?.info.agent, undefined);
});

test("parseAgHostInfo 放行 {denied:\"scope\"}; 上下文分档", () => {
  assert.deepEqual(parseAgHostInfo({ denied: "scope" }), { port: 0, v: 0, routes: [], denied: "scope" });
  assert.deepEqual(parseAgHostInfo({ port: 7841, v: 1, routes: ROUTES, denied: "scope" }), { port: 7841, v: 1, routes: [], denied: "scope" });
  assert.equal(parseAgHostInfo({ denied: "other" }), null);
  assert.deepEqual([0.1, 0.5, 0.79, 0.8, 0.96, undefined].map(agCtxBand), [0, 0.5, 0.5, 0.8, 0.95, undefined]);
  assert.deepEqual(parseClientFrame(JSON.stringify({ t: "ag_ack", aid: "a", sid: "s1", rid: "r1", by: "hub" })), { t: "ag_ack", aid: "a", sid: "s1", rid: "r1", by: "hub" });
  assert.equal(parseClientFrame(JSON.stringify({ t: "ag_ack", aid: "a", sid: "s1", rid: "r1", by: "phone" })), null);
});

test("先答先得: 第一个答复转给探针并广播撤回, 第二个只收到 ag_unreq", async () => {
  const s = setup();
  const p = s.probe();
  const a = s.connect({ device: "web-a" });
  const b = s.connect({ device: "android-b" });
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card({ host: "evil", quiet: true }) }));
  assert.equal((s.toClients[0]?.card as AgCard).host, "pc");
  assert.equal(s.pushes.length, 1);
  assert.equal(s.pushes[0]?.p.silent, true);
  assert.equal(s.pushes[0]?.p.url, "/#/agent/gui/pc/s1");
  assert.equal(s.store.open().length, 1);
  await s.gui.handle(a, a.a, s.frame({ t: "ag_answer", aid: "a1", host: "pc", sid: "s1", rid: "r1", option: "allow" }));
  assert.deepEqual(p.frames.at(-1), { t: "ag_answer", aid: "a1", sid: "s1", rid: "r1", option: "allow", text: "" });
  assert.deepEqual(s.toClients.at(-1), { t: "ag_unreq", host: "pc", sid: "s1", rid: "r1", by: "web" });
  await s.gui.handle(b, b.a, s.frame({ t: "ag_answer", aid: "b1", host: "pc", sid: "s1", rid: "r1", option: "reject" }));
  assert.deepEqual(b.frames.at(-1), { t: "ag_unreq", host: "pc", sid: "s1", rid: "r1", by: "web" });
  assert.equal(p.frames.filter((f) => f.t === "ag_answer").length, 1);
  assert.equal(s.store.open().length, 0);
  // 探针说其实是电脑上先答的: 以探针为准, 改正 by 并重新广播; 再重发不广播不推
  await s.gui.handle(p, p.a, s.frame({ t: "ag_unreq", sid: "s1", rid: "r1", by: "desktop" }));
  assert.deepEqual(s.toClients.at(-1), { t: "ag_unreq", host: "pc", sid: "s1", rid: "r1", by: "desktop" });
  assert.equal(s.store.get("pc", "r1")?.by, "desktop");
  const n = s.toClients.length;
  await s.gui.handle(p, p.a, s.frame({ t: "ag_unreq", sid: "s1", rid: "r1", by: "desktop" }));
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card() }));
  assert.equal(s.toClients.length, n);
  assert.equal(s.pushes.length, 1);
});

test("ag_ack: 生效回告 ok, 被抢先则改正 by 并回告答题端 ok:false", async () => {
  const s = setup();
  const p = s.probe();
  const web = s.connect({ device: "web-a" });
  const phone = s.connect({ device: "android-b" });
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card() }));
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card({ rid: "r2" }) }));
  await s.gui.handle(web, web.a, s.frame({ t: "ag_answer", aid: "w1", host: "pc", sid: "s1", rid: "r1", option: "allow" }));
  await s.gui.handle(p, p.a, s.frame({ t: "ag_ack", aid: "w1", sid: "s1", rid: "r1", by: "hub" }));
  assert.deepEqual(web.frames.at(-1), { t: "ag_answered", aid: "w1", host: "pc", sid: "s1", rid: "r1", ok: true, by: "web" });
  await s.gui.handle(phone, phone.a, s.frame({ t: "ag_answer", aid: "p1", host: "pc", sid: "s1", rid: "r2", option: "allow" }));
  assert.deepEqual(s.toClients.at(-1), { t: "ag_unreq", host: "pc", sid: "s1", rid: "r2", by: "phone" });
  await s.gui.handle(p, p.a, s.frame({ t: "ag_ack", aid: "p1", sid: "s1", rid: "r2", by: "desktop" }));
  assert.deepEqual(phone.frames.at(-1), { t: "ag_answered", aid: "p1", host: "pc", sid: "s1", rid: "r2", ok: false, by: "desktop" });
  assert.deepEqual(s.toClients.at(-1), { t: "ag_unreq", host: "pc", sid: "s1", rid: "r2", by: "desktop" });
  assert.equal(s.store.get("pc", "r2")?.by, "desktop");
  // 别的主机伪造的 ack 不碰这一端
  const n = phone.frames.length;
  await s.gui.handle(p, p.a, s.frame({ t: "ag_ack", aid: "p1", sid: "s1", rid: "r2", by: "agent" }));
  assert.equal(phone.frames.length, n);
});

test("补推: 卡片与 loud 同一次写", async () => {
  const sql = memSql();
  const writes: string[] = [];
  const spy = { exec: (q: string, ...b: unknown[]) => (/^\s*(update|insert)/i.test(q) && writes.push(q), sql.exec(q, ...b)) } as unknown as SqlStorage;
  const store = new AgentGuiStore(spy);
  store.put(card({ quiet: true }), 1, false);
  writes.length = 0;
  const r = store.put(card(), 2, true);
  assert.equal(r.kind, "update");
  assert.equal(writes.length, 1);
  assert.equal(store.get("pc", "r1")?.loud, 1);
  assert.equal(store.put(card({ quiet: true }), 3, false).loudBefore, true);
  assert.equal(store.get("pc", "r1")?.loud, 1);
});

test("ag_reindex: DO 醒来索引为空时 welcome 向在线 Agent 探针要一次, 只要一次", async () => {
  const s = setup();
  const p = s.probe();
  const q = s.probe("nas");
  await s.gui.handle(q, q.a, s.frame({ t: "ag_index", sessions: [] }));
  s.probe("old", false);
  s.gui.welcomeFrame();
  assert.deepEqual(p.frames, [{ t: "ag_reindex" }]);
  assert.equal(q.frames.filter((f) => f.t === "ag_reindex").length, 0);
  s.gui.welcomeFrame();
  assert.equal(p.frames.length, 1);
});

test("ag_index: 只有 updated 变了不广播", async () => {
  const s = setup();
  const p = s.probe();
  const item = { id: "s1", agent: "claude", title: "x", state: "running", pending: 0, updated: 1, ctx: 0.5 };
  await s.gui.handle(p, p.a, s.frame({ t: "ag_index", sessions: [item] }));
  const n = s.toClients.length;
  await s.gui.handle(p, p.a, s.frame({ t: "ag_index", sessions: [{ ...item, updated: 99 }] }));
  assert.equal(s.toClients.length, n);
  await s.gui.handle(p, p.a, s.frame({ t: "ag_index", sessions: [{ ...item, state: "waiting", pending: 1 }] }));
  assert.equal(s.toClients.length, n + 1);
});

test("主机 key 缺 probe:agent: ag_hosts 带 denied; scope 接口按主机名补上并断开探针", async () => {
  const s = setup();
  const registry = new Registry(memSql());
  const { info } = await registry.createKey({ name: "探针 nas", scopes: ["probe"], subject: "nas" });
  await registry.createKey({ name: "别的", scopes: ["events:write"], subject: "nas" });
  const bad = s.connect({ role: "probe", device: "probe-nas", keyId: info.id, host: { subject: "nas", online: true, seen: 1, info: { agent: { port: 7841, v: 1, routes: [], denied: "scope" } } } });
  assert.deepEqual(s.gui.hosts(), [{ subject: "nas", online: true, routes: [], sessions: [], denied: "scope" }]);
  const core = { agentGui: s.gui, registry } as unknown as Core;
  const owner: Principal = { owner: true, user: user(OWNER_UID) };
  const path = PATH_PROBE_SCOPE.replace("{id}", "nas");
  assert.equal((await call(core, PROBE_ROUTES, owner, "POST", path, { add: ["probe:shell"] })).status, 400);
  assert.equal((await call(core, PROBE_ROUTES, owner, "POST", PATH_PROBE_SCOPE.replace("{id}", "nowhere"), { add: ["probe:agent"] })).status, 404);
  assert.equal((await call(core, PROBE_ROUTES, memberWho("u2"), "POST", path, { add: ["probe:agent"] })).status, 403);
  const ok = await call(core, PROBE_ROUTES, owner, "POST", path, { add: ["probe:agent"] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
  assert.deepEqual(registry.key(info.id)?.scopes, ["probe", "probe:agent"]);
  assert.equal(bad.closed, 4010);
  // 再补一次: 已有, 不再断开
  bad.closed = undefined;
  assert.equal((await call(core, PROBE_ROUTES, owner, "POST", PATH_PROBE_SCOPE.replace("{id}", info.id), { add: ["probe:agent"] })).status, 200);
  assert.equal(bad.closed, undefined);
});

test("静默推送后 quiet:false 重发补一次正常推送, 只补一次", async () => {
  const s = setup();
  const p = s.probe();
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card({ quiet: true }) }));
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card({ quiet: true }) }));
  assert.equal(s.pushes.length, 1);
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card() }));
  assert.equal(s.pushes.length, 2);
  assert.equal(s.pushes[1]?.p.silent, undefined);
  assert.equal(s.pushes[1]?.urgent, true);
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card() }));
  assert.equal(s.pushes.length, 2);
  assert.equal(pushOf(card()).tag, "ag-pc-r1");
});

test("撤回: 探针说电脑上答了, 广播 ag_unreq, 之后手机答复被告知已处理", async () => {
  const s = setup();
  const p = s.probe();
  const phone = s.connect({ device: "android-x" });
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card() }));
  await s.gui.handle(p, p.a, s.frame({ t: "ag_unreq", sid: "s1", rid: "r1", by: "desktop" }));
  assert.deepEqual(s.toClients.at(-1), { t: "ag_unreq", host: "pc", sid: "s1", rid: "r1", by: "desktop" });
  await s.gui.handle(phone, phone.a, s.frame({ t: "ag_answer", aid: "x", host: "pc", sid: "s1", rid: "r1", option: "allow" }));
  assert.deepEqual(phone.frames.at(-1), { t: "ag_unreq", host: "pc", sid: "s1", rid: "r1", by: "desktop" });
  assert.equal(p.frames.filter((f) => f.t === "ag_answer").length, 0);
});

test("答复校验: 选项不在请求里, 主机离线时保留卡片", async () => {
  const s = setup();
  const p = s.probe();
  const c = s.connect({ device: "web-a" });
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card() }));
  await s.gui.handle(c, c.a, s.frame({ t: "ag_answer", aid: "x", host: "pc", sid: "s1", rid: "r1", option: "nope" }));
  assert.equal(c.frames.at(-1)?.t, "err");
  s.wss.splice(s.wss.indexOf(p), 1);
  await s.gui.handle(c, c.a, s.frame({ t: "ag_answer", aid: "y", host: "pc", sid: "s1", rid: "r1", option: null }));
  assert.equal(c.frames.at(-1)?.t, "err");
  assert.equal(s.store.open().length, 1);
});

test("权限: 子号的答复与没有 probe:agent 的探针都被拒", async () => {
  const s = setup();
  const p = s.probe();
  const bad = s.probe("nas", false);
  const member = s.connect({ device: "web-m", member: true, uid: "u2" });
  await s.gui.handle(bad, bad.a, s.frame({ t: "ag_req", card: card() }));
  assert.equal(bad.frames.at(-1)?.code, "forbidden");
  assert.equal(s.store.open().length, 0);
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card() }));
  await s.gui.handle(member, member.a, s.frame({ t: "ag_answer", aid: "m", host: "pc", sid: "s1", rid: "r1", option: "allow" }));
  assert.equal(member.frames.at(-1)?.code, "forbidden");
  const client = s.connect({ device: "web-a" });
  await s.gui.handle(client, client.a, s.frame({ t: "ag_index", sessions: [] }));
  assert.equal(client.frames.at(-1)?.code, "forbidden");
  assert.equal(s.store.open().length, 1);
});

test("会话索引: 只放内存, 广播 ag_hosts, 探针断开清掉; 已无待批的会话收掉旧卡片", async () => {
  const s = setup();
  const p = s.probe();
  await s.gui.handle(p, p.a, s.frame({ t: "ag_req", card: card() }));
  s.store.put(card({ rid: "r0" }), Date.now() - 60_000);
  await s.gui.handle(p, p.a, s.frame({ t: "ag_index", sessions: [{ id: "s1", agent: "claude", title: "x", state: "idle", pending: 0, updated: 1 }] }));
  const hosts = s.toClients.at(-1) as { t: string; hosts: { subject: string; sessions: unknown[]; routes: unknown[] }[] };
  assert.equal(hosts.t, "ag_hosts");
  assert.equal(hosts.hosts[0]?.sessions.length, 1);
  assert.deepEqual(hosts.hosts[0]?.routes, ROUTES);
  // r0 收得早被收掉, r1 刚到还在宽限期里
  assert.deepEqual(s.store.open().map((c) => c.rid), ["r1"]);
  assert.ok(s.toClients.some((f) => f.t === "ag_unreq" && f.rid === "r0" && f.by === "agent"));
  const att = p.a;
  s.wss.splice(s.wss.indexOf(p), 1);
  s.gui.probeGone(att);
  assert.deepEqual((s.toClients.at(-1) as { hosts: unknown[] }).hosts, []);
});

test("清理: done 24 小时后删, open 7 天后删", () => {
  const s = setup();
  const now = Date.now();
  s.store.put(card({ rid: "a" }), now);
  s.store.put(card({ rid: "b" }), now);
  s.store.done("pc", "a", "web", now);
  assert.equal(s.gui.sweep(now + AG_DONE_TTL_MS - 1), 0);
  assert.equal(s.gui.sweep(now + AG_DONE_TTL_MS + 1), 1);
  assert.equal(s.gui.sweep(now + AG_OPEN_TTL_MS - 1), 0);
  assert.equal(s.gui.sweep(now + AG_OPEN_TTL_MS + 1), 1);
});

test("配对: 探针回包, 超时, 探针断开", async () => {
  const s = setup();
  const device = { id: "d1", name: "笔记本", pub: PUB as never };
  const p = s.probe("pc", true, (f, ws) => {
    if (f.t === "ag_pair") queueMicrotask(() => void s.gui.handle(ws, ws.a, s.frame({ t: "ag_paired", pid: f.pid, ok: true, device: { ...device, added: 5 }, pub: PUB, routes: ROUTES })));
  });
  const r = await s.gui.pair("pc", device);
  assert.equal(r?.ok, true);
  assert.equal(p.frames[0]?.t, "ag_pair");
  const silent = s.probe("nas");
  assert.equal(await s.gui.pair("nas", device, 20), null);
  const pending = s.gui.pair("nas", device, 5000);
  s.gui.probeGone(silent.a);
  assert.equal((await pending)?.ok, false);
  assert.equal(await s.gui.pair("nowhere", device), null);
});

test("配对接口: 密码错 5 次锁定, 与终端票据共用; 非主账号 403; 收件箱", async () => {
  const s = setup();
  s.probe("pc", true, (f, ws) => {
    if (f.t === "ag_pair") queueMicrotask(() => void s.gui.handle(ws, ws.a, s.frame({ t: "ag_paired", pid: f.pid, ok: true, device: { id: "d1", name: "n", pub: PUB, added: 5 }, pub: PUB, routes: ROUTES })));
  });
  const core = { agentGui: s.gui, checkPassword: async (_id: string, pw: string) => pw === PASSWORD } as unknown as Core;
  const owner: Principal = { owner: true, user: user(OWNER_UID) };
  const body = (password: string) => ({ subject: "pc", password, device: { id: "d1", name: "n", pub: PUB } });
  const ok = await call(core, AGENT_GUI_ROUTES, owner, "POST", PATH_AGENT_GUI_PAIR, body(PASSWORD));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.routes, ROUTES);
  assert.equal(ok.body.host, "pc");
  assert.equal((await call(core, AGENT_GUI_ROUTES, memberWho("u2"), "POST", PATH_AGENT_GUI_PAIR, body(PASSWORD))).status, 403);
  assert.equal((await call(core, AGENT_GUI_ROUTES, owner, "POST", PATH_AGENT_GUI_PAIR, { ...body(PASSWORD), device: { id: "d1", pub: { ...PUB, crv: "P-384" } } })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await call(core, AGENT_GUI_ROUTES, owner, "POST", PATH_AGENT_GUI_PAIR, body("bad"))).status, 403);
  assert.equal((await call(core, AGENT_GUI_ROUTES, owner, "POST", PATH_AGENT_GUI_PAIR, body(PASSWORD))).status, 429);
  resetPasswordFailures();
  const off = await call(core, AGENT_GUI_ROUTES, owner, "POST", PATH_AGENT_GUI_PAIR, { ...body(PASSWORD), subject: "nas" });
  assert.equal(off.status, 409);
  s.store.put(card({ rid: "late" }), 2);
  s.store.put(card({ rid: "early" }), 1);
  const inbox = await call(core, AGENT_GUI_ROUTES, owner, "GET", PATH_AGENT_GUI_INBOX);
  assert.deepEqual((inbox.body.cards as AgCard[]).map((c) => c.rid), ["early", "late"]);
  assert.equal((inbox.body.hosts as unknown[]).length, 1);
});
