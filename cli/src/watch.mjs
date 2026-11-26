// 监听: 优先 WebSocket 长连 (服务端推送不计费, 心跳自动应答不计费), 连不上退回定时拉取, 并定期再试长连
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { saveHead, saveUntil, loadState } from "./config.mjs";
import { isMine, print } from "./format.mjs";
import { PROTOCOL, call, enc, guideChanged, headers } from "./http.mjs";

const PING_MS = 25_000;
const RETRY_WS_MS = 60_000;
const DEFAULT_POLL_S = 20;
const POLL_LIMIT = 100;
const EXIT_TIMEOUT = 2;
const EXIT_GUIDE = 3;
const EXIT_AGAIN = 4;
const SLACK_MS = 1000;

/** --window: 第一次调用开一个窗口, 之后的调用接着等到窗口结束; 返回本次最多等多久 (ms) 和截止时间。 */
function budget(opts, now = Date.now()) {
  const cap = opts.timeout > 0 ? opts.timeout * 1000 : Infinity;
  if (!(opts.window > 0)) return { ms: cap, until: 0 };
  let until = loadState().until;
  if (!until || until <= now + SLACK_MS) {
    until = now + opts.window * 1000;
    saveUntil(until);
  }
  return { ms: Math.min(cap, until - now), until };
}

const SYSTEM_PREFIX = "system:";
/** 是不是要叫醒: 默认只认人 (App 里的人, 或用主人令牌直接发的, 都不带来源类型或类型为 user); --any 时别的 Agent 和系统消息也算。 */
function wake(ev, me, opts) {
  if (opts.any) return opts.mine || !isMine(ev, me);
  const src = ev.source ?? {};
  if (ev.deleted || isMine(ev, me) || String(src.id ?? "").startsWith(SYSTEM_PREFIX)) return false;
  return !src.type || src.type === "user";
}

/**
 * opts: channels (null = 能读的全部), once, timeout (秒), window (秒), json, exec, mine, any, interval (秒), guide (已报到的指令版本)
 * peek: 只等不记 (next 用), 不推进任何本地 head, 第一条要叫醒的消息交给 deliver 后结束; since 为补发起点。
 * 返回进程退出码: 0 收到消息 (once) 或被打断, 2 等满了没人说话, 3 指令更新了, 4 本次到点但窗口没满 (再跑一次)。
 */
export function watch(cfg, me, opts) {
  return new Promise((resolve) => {
    let done = false;
    let ws = null;
    let pollTimer = null;
    let pingTimer = null;
    const peek = !!opts.peek;
    const once = opts.once || peek;
    const { ms, until } = budget(opts);
    const finish = (code) => {
      if (done) return;
      done = true;
      // 等到消息或窗口用完就关掉窗口, 下一轮重新计 5 分钟
      if (until && (code === 0 || code === EXIT_TIMEOUT)) saveUntil(0);
      clearTimeout(timer);
      clearInterval(pollTimer);
      clearInterval(pingTimer);
      try {
        ws?.close();
      } catch {}
      resolve(code);
    };
    const expire = () => finish(until && Date.now() < until - SLACK_MS ? EXIT_AGAIN : EXIT_TIMEOUT);
    // 不 unref: 握手失败到退回拉取之间事件循环可能是空的, 靠它撑住
    const timer = Number.isFinite(ms) ? setTimeout(expire, Math.max(0, ms)) : null;
    process.once("SIGINT", () => finish(0));

    const wanted = (ev) => {
      const ch = ev.channel;
      if (!ch || (opts.channels && !opts.channels.includes(ch))) return false;
      return wake(ev, me, opts);
    };
    const guide = (version) => {
      if (peek || !version || version === opts.guide) return;
      process.stdout.write(opts.json ? `${JSON.stringify({ guide: version })}\n` : `专属指令已更新到 ${version}: 先运行 hxaioa guide --ack\n`);
      if (opts.once) finish(EXIT_GUIDE);
    };
    const deliver = opts.deliver ?? ((ev) => {
      print(ev, opts.json);
      if (opts.exec) runExec(opts.exec, ev);
    });
    // peek 时的读到位置只在内存里
    const local = {};
    const advance = (ch, seq) => {
      if (!ch) return;
      if (peek) local[ch] = Math.max(local[ch] ?? 0, seq);
      else saveHead(ch, seq);
    };
    const seen = new Set();
    // #114: 先交出 (打印或 exec) 再推进 head; --once 结束后到的消息不碰 head, 下次 read --new 还能拿到
    const handle = (ev) => {
      if (done || seen.has(ev.seq)) return;
      seen.add(ev.seq);
      const hit = wanted(ev);
      if (hit) deliver(ev);
      advance(ev.channel, ev.seq);
      if (hit && once) finish(0);
    };

    // 插件更新: 服务端推到 Agent 长连, 马上提示换指令; --once 时就此醒来, 让调用方立即处理
    // 退出码与 guide 帧一致 (3): 调用方先 hxaioa guide --ack 再等
    const pluginChanged = (f) => {
      if (done || peek) return;
      process.stderr.write(`插件 ${f.id} 已${f.change === "updated" ? "更新" : "变化"}${f.version ? `到 ${f.version}` : ""}: 先运行 hxaioa guide --ack, 用新全文替换旧指令再继续。\n`);
      if (opts.json) process.stdout.write(`${JSON.stringify({ t: "guide", id: f.id, version: f.version ?? null })}\n`);
      if (opts.once) finish(EXIT_GUIDE);
    };

    const poll = async () => {
      const heads = peek ? local : loadState().heads;
      for (const ch of opts.channels ?? [me.channel].filter(Boolean)) {
        try {
          const since = heads[ch] ?? opts.since ?? 0;
          const r = await call(cfg, "GET", `/api/v1/chats/${enc(ch)}/messages?since=${since}&limit=${POLL_LIMIT}`);
          const list = r.messages ?? [];
          for (const ev of list) handle(ev);
          // 这一批全交出了才把 head 推到服务端的位置; 还有下一页时 head 会跳过没拉到的
          if (r.head && !done && list.length < POLL_LIMIT) advance(ch, r.head);
        } catch (e) {
          process.stderr.write(`拉取 ${ch} 失败: ${e.message}\n`);
        }
      }
      guide(guideChanged());
    };
    const startPolling = () => {
      if (pollTimer || done) return;
      process.stderr.write("长连接不可用, 改为定时拉取\n");
      pollTimer = setInterval(poll, (opts.interval || DEFAULT_POLL_S) * 1000);
      poll();
      setTimeout(() => !done && connect(), RETRY_WS_MS).unref?.();
    };
    const connect = () => {
      const since = peek ? Math.max(opts.since ?? 0, ...Object.values(local)) : loadState().last;
      const url = new URL("/api/v1/stream", cfg.server.replace(/^http/, "ws"));
      url.searchParams.set("token", cfg.key);
      url.searchParams.set("role", "chat");
      url.searchParams.set("device", `cli-${hostname()}`.slice(0, 64));
      if (since) url.searchParams.set("since", String(since));
      url.searchParams.set("pv", String(PROTOCOL));
      let open = false;
      try {
        ws = new WebSocket(url, { headers: headers(cfg.key) });
      } catch {
        return startPolling();
      }
      ws.onopen = () => {
        open = true;
        clearInterval(pollTimer);
        pollTimer = null;
        pingTimer = setInterval(() => ws.readyState === 1 && ws.send("ping"), PING_MS);
        process.stderr.write("已连上, 正在监听\n");
        guide(guideChanged());
      };
      ws.onmessage = (m) => {
        if (typeof m.data !== "string" || m.data === "pong") return;
        let f;
        try {
          f = JSON.parse(m.data);
        } catch {
          return;
        }
        if (f.t === "welcome" && f.compat && f.compat.level !== "ok") process.stderr.write(`服务端提示: ${f.compat.msg ?? f.compat.level}, 请更新 hxaioa\n`);
        else if (f.t === "ev" && f.ev) handle(f.ev);
        else if (f.t === "guide") guide(f.version);
        else if (f.t === "plugin_update" && f.guide) pluginChanged(f);
      };
      ws.onclose = (e) => {
        clearInterval(pingTimer);
        if (done) return;
        if (e.code === 4001 || e.code === 4003) {
          process.stderr.write("密钥已失效, 请让主人重新接入\n");
          return finish(1);
        }
        if (open) setTimeout(connect, 3000);
        else startPolling();
      };
      // 有的 Node 版本握手失败只发 error 不发 close
      ws.onerror = () => !open && startPolling();
    };
    connect();
  });
}

// 每条消息跑一次外部命令: 消息 JSON 走 stdin, 关键字段放环境变量
function runExec(cmd, ev) {
  const env = { ...process.env, AIOA_SEQ: String(ev.seq), AIOA_CHANNEL: ev.channel ?? "", AIOA_FROM: ev.source?.name ?? "" };
  const p = spawn(cmd, { shell: true, env, stdio: ["pipe", "inherit", "inherit"] });
  p.stdin.end(JSON.stringify(ev));
}
