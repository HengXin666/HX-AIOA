// 监听: 优先 WebSocket 长连 (服务端推送不计费, 心跳自动应答不计费), 连不上退回定时拉取, 并定期再试长连
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { saveHead, loadState } from "./config.mjs";
import { isMine, print } from "./format.mjs";
import { call, enc, headers } from "./http.mjs";

const PING_MS = 25_000;
const RETRY_WS_MS = 60_000;
const DEFAULT_POLL_S = 20;
const EXIT_TIMEOUT = 2;

/**
 * opts: channels (null = 能读的全部), once, timeout (秒), json, exec, mine, interval (秒)
 * 返回进程退出码: 0 收到消息 (once) 或被打断, 2 超时没等到。
 */
export function watch(cfg, me, opts) {
  return new Promise((resolve) => {
    let done = false;
    let ws = null;
    let pollTimer = null;
    let pingTimer = null;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearInterval(pollTimer);
      clearInterval(pingTimer);
      try {
        ws?.close();
      } catch {}
      resolve(code);
    };
    if (opts.timeout > 0) setTimeout(() => finish(EXIT_TIMEOUT), opts.timeout * 1000).unref?.();
    process.once("SIGINT", () => finish(0));

    const wanted = (ev) => {
      const ch = ev.channel;
      if (!ch || (opts.channels && !opts.channels.includes(ch))) return false;
      return opts.mine || !isMine(ev, me);
    };
    const seen = new Set();
    const handle = (ev) => {
      if (done || seen.has(ev.seq)) return;
      seen.add(ev.seq);
      if (ev.channel) saveHead(ev.channel, ev.seq);
      if (!wanted(ev)) return;
      print(ev, opts.json);
      if (opts.exec) runExec(opts.exec, ev);
      if (opts.once) finish(0);
    };

    // 插件更新: 服务端推到 Agent 长连, 马上提示换指令; --once 时就此醒来, 让调用方立即处理
    const guideChanged = (f) => {
      if (done) return;
      process.stderr.write(`插件 ${f.id} 已${f.change === "updated" ? "更新" : "变化"}${f.version ? `到 ${f.version}` : ""}: 先运行 hxaioa guide --ack, 用新全文替换旧指令再继续。\n`);
      if (opts.json) process.stdout.write(`${JSON.stringify({ t: "guide", id: f.id, version: f.version ?? null })}\n`);
      if (opts.once) finish(0);
    };

    const poll = async () => {
      const heads = loadState().heads;
      for (const ch of opts.channels ?? [me.channel].filter(Boolean)) {
        try {
          const r = await call(cfg, "GET", `/api/v1/chats/${enc(ch)}/messages?since=${heads[ch] ?? 0}&limit=100`);
          for (const ev of r.messages ?? []) handle(ev);
          if (r.head) saveHead(ch, r.head);
        } catch (e) {
          process.stderr.write(`拉取 ${ch} 失败: ${e.message}\n`);
        }
      }
    };
    const startPolling = () => {
      if (pollTimer || done) return;
      process.stderr.write("长连接不可用, 改为定时拉取\n");
      pollTimer = setInterval(poll, (opts.interval || DEFAULT_POLL_S) * 1000);
      poll();
      setTimeout(() => !done && connect(), RETRY_WS_MS).unref?.();
    };
    const connect = () => {
      const since = loadState().last;
      const url = new URL("/api/v1/stream", cfg.server.replace(/^http/, "ws"));
      url.searchParams.set("token", cfg.key);
      url.searchParams.set("role", "chat");
      url.searchParams.set("device", `cli-${hostname()}`.slice(0, 64));
      if (since) url.searchParams.set("since", String(since));
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
      };
      ws.onmessage = (m) => {
        if (typeof m.data !== "string" || m.data === "pong") return;
        let f;
        try {
          f = JSON.parse(m.data);
        } catch {
          return;
        }
        if (f.t === "ev" && f.ev) handle(f.ev);
        else if (f.t === "plugin_update" && f.guide) guideChanged(f);
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
      ws.onerror = () => {};
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
