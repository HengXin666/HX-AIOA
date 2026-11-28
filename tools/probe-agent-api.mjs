// 直连的 hx 方法: 会话, 回放翻页, 实例, 设置, 设备, git, 文件
import { gitStatus, gitDiff, fsTree, fsRead } from "./probe-agent-hx.mjs";
import { INSTANCE_KINDS, WATCH_PUSH, RECENT_DIRS, PRESETS, ST } from "./probe-agent-const.mjs";

const ID_RE = /^[\w.-]{1,40}$/;
const REPUSH_RANGE = [5, 3600];

function checkInstance(p) {
  if (!p || typeof p !== "object") throw new Error("需要 Instance");
  if (!ID_RE.test(String(p.id ?? ""))) throw new Error("实例 id 只能是字母数字 . _ -, 最长 40");
  if (!INSTANCE_KINDS.includes(p.kind)) throw new Error(`kind 只能是 ${INSTANCE_KINDS.join(" / ")}`);
  if (typeof p.cmd !== "string" || !p.cmd.trim()) throw new Error("需要启动命令 cmd");
  const args = Array.isArray(p.args) ? p.args.map(String) : [];
  const inst = { id: p.id, name: String(p.name || p.id).slice(0, 60), kind: p.kind, cmd: p.cmd.trim(), args };
  if (p.env && typeof p.env === "object") inst.env = Object.fromEntries(Object.entries(p.env).map(([k, v]) => [k, String(v)]));
  for (const k of ["model", "mode"]) if (typeof p[k] === "string" && p[k]) inst[k] = p[k];
  return inst;
}

function checkSettings(cur, p) {
  const next = { ...cur };
  if (p.watchPush !== undefined) {
    if (!WATCH_PUSH.includes(p.watchPush)) throw new Error(`watchPush 只能是 ${WATCH_PUSH.join(" / ")}`);
    next.watchPush = p.watchPush;
  }
  if (p.quietRepushSec !== undefined) {
    const n = Number(p.quietRepushSec);
    if (!Number.isFinite(n) || n < REPUSH_RANGE[0] || n > REPUSH_RANGE[1]) throw new Error(`quietRepushSec 需在 ${REPUSH_RANGE.join("..")} 秒`);
    next.quietRepushSec = n;
  }
  return next;
}

const publicDevice = ({ id, name, pub, added, last }) => ({ id, name, pub, added, ...(last ? { last } : {}) });

async function run(ctx, conn, m, p) {
  const { store, sessions } = ctx;
  switch (m) {
    case "session/create":
      return ctx.createSession(p);
    case "session/close":
      ctx.sess(p.sid).close();
      return {};
    case "session/delete": {
      const s = ctx.sess(p.sid);
      s.remove();
      sessions.delete(s.id);
      ctx.persistIndex();
      ctx.toAll({ t: "session", info: { ...ctx.publicInfo(s.info), state: ST.closed, deleted: true } });
      return {};
    }
    case "session/rename": {
      const s = ctx.sess(p.sid);
      const title = String(p.title ?? "").trim().slice(0, 120);
      if (!title) throw new Error("标题不能为空");
      s.set({ title, titleAuto: false });
      return ctx.publicInfo(s.info);
    }
    case "session/resume":
      return ctx.resume(ctx.sess(p.sid));
    case "log/page": {
      const s = ctx.sess(p.sid);
      const w = s.log.page(Number(p.before) || s.log.seq + 1, p.limit);
      conn.push({ t: "window", sid: s.id, ...w });
      return { from: w.from, to: w.to, more: w.more };
    }
    case "instances/list":
      return store.instances;
    case "instances/save": {
      const inst = checkInstance(p);
      const i = store.instances.findIndex((x) => x.id === inst.id);
      if (i >= 0) store.instances[i] = inst;
      else store.instances.push(inst);
      store.save("instances");
      return store.instances;
    }
    case "instances/delete":
      store.instances = store.instances.filter((x) => x.id !== p.id);
      store.save("instances");
      return store.instances;
    case "instances/presets":
      return PRESETS;
    case "settings/get":
      return store.settings;
    case "settings/set":
      store.settings = checkSettings(store.settings, p ?? {});
      store.save("settings");
      return store.settings;
    case "devices/list":
      return store.devices.map(publicDevice);
    case "devices/remove": {
      store.devices = store.devices.filter((d) => d.id !== p.id);
      store.save("devices");
      for (const c of ctx.conns) if (c.device === p.id) c.ws.close(4003, "设备已移除");
      return store.devices.map(publicDevice);
    }
    case "git/status": {
      const s = ctx.sess(p.sid);
      const r = await gitStatus(s.info.cwd);
      const adds = r.files.reduce((a, f) => a + f.add, 0);
      const dels = r.files.reduce((a, f) => a + f.del, 0);
      if (adds !== s.info.adds || dels !== s.info.dels) s.set({ adds, dels });
      return r;
    }
    case "git/diff":
      return gitDiff(ctx.sess(p.sid).info.cwd, p);
    case "fs/tree":
      return fsTree(ctx.sess(p.sid).info.cwd, p.path);
    case "fs/read":
      return fsRead(ctx.sess(p.sid).info.cwd, p.path);
    case "tool/output":
      return { content: ctx.sess(p.sid).toolOutput(p.toolCallId) };
    case "dirs/recent": {
      const dirs = [];
      for (const s of [...sessions.values()].sort((a, b) => b.info.updated - a.info.updated)) {
        if (!dirs.includes(s.info.cwd)) dirs.push(s.info.cwd);
        if (dirs.length >= RECENT_DIRS) break;
      }
      return { dirs };
    }
    default:
      throw new Error(`未知方法: ${m}`);
  }
}

export async function handleHx(ctx, conn, f) {
  try {
    const r = await run(ctx, conn, f.m, f.p ?? {});
    conn.push({ t: "hx_res", id: f.id, ok: true, r });
  } catch (e) {
    conn.push({ t: "hx_res", id: f.id, ok: false, err: e.message });
  }
}
