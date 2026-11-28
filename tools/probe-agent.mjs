// 探针 ACP 多路代理 (#126): 只有 AIOA_AGENT=1 时由 probe.mjs 加载, 契约见 docs/design/agent-gui-impl.md
// 环境变量: AIOA_AGENT_LISTEN (默认 127.0.0.1:7841, 0.0.0.0:7841 开局域网), AIOA_AGENT_HOME (本地文件目录)
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, sign, verify } from "node:crypto";
import { openStore, devicePublicKey } from "./probe-agent-store.mjs";
import { startServer } from "./probe-agent-ws.mjs";
import { Session } from "./probe-agent-session.mjs";
import { handleHx } from "./probe-agent-api.mjs";
import {
  AGENT_V, AGENT_NAME, DEFAULT_LISTEN, BATCH_MS, STATS_MS, INDEX_MERGE_MS, SAVE_MS, HELLO_TIMEOUT_MS, INDEX_MAX, ST,
  BY_HUB, BY_DESKTOP, BY_AGENT, PUSH_NONE, PUSH_NORMAL,
} from "./probe-agent-const.mjs";

const CALIB = "calib";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const nonce = () => b64u(randomBytes(24));
const SIG = { dsaEncoding: "ieee-p1363" };
const SHA = "sha256";
const ANSWERED_KEEP = 200;

function parseListen(s) {
  const i = s.lastIndexOf(":");
  return { host: s.slice(0, i) || "127.0.0.1", port: Number(s.slice(i + 1)) };
}

function lanIp() {
  return Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === "IPv4")?.address;
}

export async function createAgent({ send, subject, listen = process.env.AIOA_AGENT_LISTEN || DEFAULT_LISTEN, home, deflate = process.env.AIOA_AGENT_DEFLATE !== "0" }) {
  const store = openStore(home);
  const sessions = new Map();
  const conns = new Set();
  const timers = { index: null, save: null, calib: null };
  const { host: bindHost, port: wantPort } = parseListen(listen);

  for (const info of store.sessions) {
    if (info.state !== ST.closed) Object.assign(info, { state: ST.closed, pending: 0 });
    sessions.set(info.id, new Session(core(), info, store.log(info.id)));
  }

  function saveSoon(name) {
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => (name === "save" ? persistIndex() : store.save(CALIB)), SAVE_MS);
  }

  function persistIndex() {
    store.sessions = [...sessions.values()].map((s) => s.info);
    store.save("index");
  }

  const publicInfo = (info) => {
    const { acpSid, titleAuto, model, ...rest } = info;
    return rest;
  };

  function routes() {
    const out = [{ kind: "local", url: `http://127.0.0.1:${port}` }];
    const ip = process.env.AIOA_IP || lanIp();
    if ((bindHost === "0.0.0.0" || bindHost === "::") && ip) out.push({ kind: "lan", url: `http://${ip}:${port}` });
    return out;
  }

  const watched = (sid) => [...conns].some((c) => c.fg && c.subs.has(sid));
  const attached = (sid) => [...conns].filter((c) => c.subs.has(sid));
  const toAttached = (sid, frame) => attached(sid).forEach((c) => c.push(frame));
  const toAll = (frame) => conns.forEach((c) => c.device && c.push(frame));

  function sendIndex() {
    clearTimeout(timers.index);
    timers.index = null;
    const list = [...sessions.values()].map((s) => s.info).sort((a, b) => b.updated - a.updated).slice(0, INDEX_MAX);
    send({ t: "ag_index", sessions: list.map(({ id, agent, title, state, ctx, pending, updated }) => ({ id, agent, title, state, ctx, pending, updated })) });
  }

  // quiet: 有前台客户端附着; 按设置决定首推方式, 静默推后 quietRepushSec 秒没人答就正常重推一次
  function hubReq(sess, perm) {
    clearTimeout(perm.timer);
    const mode = store.settings.watchPush;
    const isWatched = watched(sess.id);
    const quiet = isWatched && mode !== PUSH_NORMAL;
    if (!(isWatched && mode === PUSH_NONE)) send({ t: "ag_req", card: { ...perm.card, quiet } });
    if (quiet) {
      perm.timer = setTimeout(() => {
        if (!perm.done) send({ t: "ag_req", card: { ...perm.card, quiet: false } });
      }, store.settings.quietRepushSec * 1000);
      perm.timer.unref?.();
    }
  }

  function statsSoon(sess) {
    if (sess.statsTimer) return;
    const wait = Math.max(0, (sess.statsAt ?? 0) + STATS_MS - Date.now());
    sess.statsTimer = setTimeout(() => {
      sess.statsTimer = null;
      sess.statsAt = Date.now();
      toAttached(sess.id, sess.stats.frame(sess.id));
    }, wait);
  }

  function core() {
    return {
      store,
      host: subject,
      record(sess, entry, own) {
        for (const c of attached(sess.id)) {
          const m = own && own.conn === c ? { ...entry.m, id: own.cid } : entry.m;
          c.push({ t: "acp", sid: sess.id, seq: entry.seq, m });
        }
      },
      info(sess) {
        toAll({ t: "session", info: publicInfo(sess.info) });
        saveSoon("save");
        if (!timers.index) timers.index = setTimeout(sendIndex, INDEX_MERGE_MS);
      },
      permReq(sess, perm) {
        toAttached(sess.id, { t: "perm_req", sid: sess.id, rid: perm.rid, card: perm.card });
        hubReq(sess, perm);
      },
      permDone(sess, perm, by, option) {
        toAttached(sess.id, { t: "perm_done", sid: sess.id, rid: perm.rid, by, option });
        if (by !== BY_HUB) send({ t: "ag_unreq", sid: sess.id, rid: perm.rid, by });
        sess.answered = sess.answered ?? new Map();
        sess.answered.set(perm.rid, by);
        if (sess.answered.size > ANSWERED_KEEP) sess.answered.delete(sess.answered.keys().next().value);
      },
      stats: statsSoon,
      calib: () => saveSoon(CALIB),
    };
  }

  function instance(id) {
    const inst = store.instances.find((i) => i.id === id);
    if (!inst) throw new Error(`没有这个 Agent 实例: ${id}`);
    return inst;
  }

  async function createSession(p) {
    const inst = instance(p.instance);
    let cwd = String(p.cwd ?? "");
    if (cwd === "~" || cwd.startsWith("~/")) cwd = path.join(os.homedir(), cwd.slice(1));
    if (!path.isAbsolute(cwd) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`目录不存在: ${p.cwd}`);
    const id = `s${randomBytes(5).toString("hex")}`;
    const now = Date.now();
    const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : path.basename(cwd);
    const info = { id, instance: inst.id, agent: inst.name, title, titleAuto: !p.title, cwd, state: ST.starting, created: now, updated: now, pending: 0 };
    const sess = new Session(core(), info, store.log(id));
    sessions.set(id, sess);
    try {
      await sess.start(inst, { mode: p.mode, model: p.model });
    } catch (e) {
      sessions.delete(id);
      sess.remove();
      toAll({ t: "session", info: { ...publicInfo(info), state: ST.closed, deleted: true } });
      persistIndex();
      throw e;
    }
    return publicInfo(sess.info);
  }

  function sess(sid) {
    const s = sessions.get(sid);
    if (!s) throw new Error(`会话不存在: ${sid}`);
    return s;
  }

  const ctx = {
    store,
    sessions,
    conns,
    sess,
    instance,
    createSession,
    publicInfo,
    persistIndex,
    toAll,
    async resume(s) {
      if (s.live()) return publicInfo(s.info);
      await s.start(instance(s.info.instance), { resume: true });
      return publicInfo(s.info);
    },
  };

  function attach(conn, f) {
    const s = sess(f.sid);
    conn.subs.add(s.id);
    let w = typeof f.since === "number" ? s.log.since(f.since) : null;
    if (!w) w = s.log.window();
    conn.push({ t: "window", sid: s.id, ...w });
    for (const perm of s.perms.values()) conn.push({ t: "perm_req", sid: s.id, rid: perm.rid, card: perm.card });
    conn.push(s.stats.frame(s.id));
    // 有人在前台看着了, 已推出去的请求不必重推; 只在新请求时按 quiet 处理
  }

  function onAuthed(conn, f) {
    switch (f.t) {
      case "attach":
        return attach(conn, f);
      case "detach":
        return conn.subs.delete(f.sid);
      case "fg":
        conn.fg = !!f.on;
        return;
      case "acp_out":
        return sess(f.sid).fromClient(conn, f.m);
      case "perm": {
        const s = sess(f.sid);
        if (!s.answer(f.rid, f.option ?? null, typeof f.text === "string" ? f.text : "", BY_DESKTOP)) {
          const by = s.answered?.get(f.rid);
          conn.push(by ? { t: "perm_done", sid: s.id, rid: f.rid, by } : { t: "error", code: "perm", msg: `权限请求不存在: ${f.rid}` });
        }
        return;
      }
      case "hx":
        return handleHx(ctx, conn, f);
      default:
        conn.push({ t: "error", code: "frame", msg: `未知帧: ${f.t}` });
    }
  }

  function onSocket(ws) {
    const conn = { ws, device: null, fg: false, subs: new Set(), queue: [], timer: null, nonce: nonce() };
    conn.push = (frame) => {
      conn.queue.push(frame);
      if (!conn.timer) conn.timer = setTimeout(() => flush(conn), BATCH_MS);
    };
    conns.add(conn);
    ws.send(JSON.stringify({ t: "challenge", nonce: conn.nonce, host: subject, pub: store.hostPub }));
    const kill = setTimeout(() => !conn.device && ws.close(4001, "握手超时"), HELLO_TIMEOUT_MS);
    ws.on("close", () => {
      clearTimeout(kill);
      clearTimeout(conn.timer);
      conns.delete(conn);
    });
    ws.on("message", (text) => {
      let frames;
      try {
        frames = JSON.parse(text);
      } catch {
        return conn.push({ t: "error", code: "json", msg: "不是 JSON" });
      }
      for (const f of Array.isArray(frames) ? frames : [frames]) {
        if (!conn.device) {
          if (!hello(conn, f)) return;
          continue;
        }
        try {
          onAuthed(conn, f);
        } catch (e) {
          conn.push({ t: "error", code: f.t ?? "frame", msg: e.message, ...(f.id !== undefined ? { id: f.id } : {}) });
        }
      }
    });
  }

  function hello(conn, f) {
    const dev = f?.t === "hello" ? store.devices.find((d) => d.id === f.device) : undefined;
    let ok = false;
    try {
      ok = !!dev && verify(SHA, Buffer.from(conn.nonce), { key: devicePublicKey(dev.pub), ...SIG }, Buffer.from(String(f.sig), "base64url"));
    } catch {}
    if (!ok) {
      conn.ws.send(JSON.stringify({ t: "error", code: "auth", msg: dev ? "签名不对" : "设备未配对" }));
      conn.ws.close(4003, "auth");
      return false;
    }
    conn.device = dev.id;
    conn.fg = f.fg !== false;
    dev.last = Date.now();
    store.save("devices");
    const list = [...sessions.values()].map((s) => publicInfo(s.info)).sort((a, b) => b.updated - a.updated);
    conn.push({ t: "ready", device: dev.id, host: subject, sessions: list, instances: store.instances, settings: store.settings });
    return true;
  }

  function flush(conn) {
    conn.timer = null;
    const q = conn.queue;
    conn.queue = [];
    if (!q.length || !conn.ws.open) return;
    conn.ws.send(JSON.stringify(q.length === 1 ? q[0] : q));
  }

  const server = await startServer({
    host: bindHost,
    port: wantPort,
    deflate,
    onSocket,
    routes: {
      "/hello": (_req, url) => {
        const r = { v: AGENT_V, host: subject, pub: store.hostPub, nonce: nonce(), agent: AGENT_NAME };
        // 补充: 带 ?n=<客户端随机串> 时主机用主机私钥签它, 客户端可据此确认对端持有配对时的主机密钥
        const n = url.searchParams.get("n");
        if (n && n.length <= 128) r.nsig = b64u(sign(SHA, Buffer.from(n), { key: store.hostPriv, ...SIG }));
        return r;
      },
    },
  });
  const port = server.address().port;
  console.log(`Agent GUI 直连已监听 ${bindHost}:${port}`);

  function pair(f) {
    const d = f.device ?? {};
    try {
      if (typeof d.id !== "string" || !d.id || d.id.length > 64) throw new Error("设备 id 不对");
      devicePublicKey(d.pub);
      const dev = { id: d.id, name: String(d.name ?? d.id).slice(0, 60), pub: d.pub, added: Date.now() };
      store.devices = store.devices.filter((x) => x.id !== dev.id).concat(dev);
      store.save("devices");
      send({ t: "ag_paired", pid: f.pid, ok: true, device: dev, pub: store.hostPub, routes: routes() });
    } catch (e) {
      send({ t: "ag_paired", pid: f.pid, ok: false, err: e.message });
    }
  }

  function hubAnswer(f) {
    const s = sessions.get(f.sid);
    try {
      if (s?.answer(f.rid, f.option ?? null, typeof f.text === "string" ? f.text : "", BY_HUB)) return;
    } catch (e) {
      console.error(`Hub 答复无效: ${e.message}`);
    }
    // 已被别处答了: 告诉 Hub 以谁为准
    const by = s?.answered?.get(f.rid);
    if (by === BY_HUB) return;
    send({ t: "ag_unreq", sid: f.sid, rid: f.rid, by: by ?? BY_AGENT });
  }

  return {
    port,
    info: () => ({ port, v: AGENT_V, routes: routes() }),
    handle(f) {
      if (f.t === "ag_pair") return pair(f);
      if (f.t === "ag_answer") return hubAnswer(f);
    },
    // 探针连上 Hub (含重连): 重报索引与所有未答的请求
    onConnect() {
      sendIndex();
      for (const s of sessions.values()) for (const perm of s.perms.values()) hubReq(s, perm);
    },
    close() {
      for (const s of sessions.values()) if (s.live()) s.close();
      persistIndex();
      store.save(CALIB);
      for (const c of conns) c.ws.close(1001, "探针退出");
      server.close();
    },
    _ctx: ctx,
  };
}
