// 延迟压测: 通过 HTTP 发消息, 用 WebSocket 收, 同一台机器计时, 不受时钟偏差影响
// 配置优先读环境变量 AIOA_URL / AIOA_TOKEN, 也可写在 tools/.env (不纳入仓库);
// 命令行 --url / --token 可覆盖。
// 用法:
//   node tools/bench.mjs [--count 50] [--interval 200] [--jitter 0]
//   node tools/bench.mjs --interactive          交互式: 每输入一行发一条, 输入 exit 退出
//   --interval  每次发送的基础间隔 (ms)
//   --jitter    在基础间隔上叠加 0~jitter 的随机抖动 (ms), 模拟真实发送节奏

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_COUNT = 50;
const DEFAULT_INTERVAL_MS = 200;
const DEFAULT_JITTER_MS = 0;
const TIMEOUT_MS = 10_000;
const BENCH_PREFIX = "bench";
// woa.qzz.io 开了 Bot Fight/Managed Challenge, 非浏览器 UA 会被 403 拦截, 压测必须伪装成浏览器
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 从 tools/.env 载入 KEY=VALUE, 不覆盖已存在的环境变量
function loadDotEnv() {
  const file = join(dirname(fileURLToPath(import.meta.url)), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const key = s.slice(0, eq).trim();
    const val = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

function arg(name, fallback) {
  const i = Math.max(process.argv.indexOf(`--${name}`), process.argv.indexOf(`-${name}`));
  return i > 0 ? process.argv[i + 1] : fallback;
}

// 同时认 -x 与 --x 两种写法
function hasFlag(name) {
  return process.argv.includes(`--${name}`) || process.argv.includes(`-${name}`);
}

loadDotEnv();

const base = arg("url", process.env.AIOA_URL);
const token = arg("token", process.env.AIOA_TOKEN);
const interactive = hasFlag("interactive") || hasFlag("i");
const count = Number(arg("count", DEFAULT_COUNT));
const interval = Number(arg("interval", DEFAULT_INTERVAL_MS));
const jitter = Math.max(0, Number(arg("jitter", DEFAULT_JITTER_MS)));
if (!base || !token) {
  console.error("缺少配置: 请设置环境变量 AIOA_URL 与 AIOA_TOKEN (或写在 tools/.env), 也可用 --url / --token 传入。");
  process.exit(1);
}

const sentAt = new Map();
const delays = [];
const wsUrl = new URL("/ws", base.replace(/^http/, "ws"));
wsUrl.searchParams.set("token", token);
wsUrl.searchParams.set("device", `${BENCH_PREFIX}-recv`);

const ws = new WebSocket(wsUrl, { headers: { "User-Agent": BROWSER_UA } });
ws.onmessage = (e) => {
  const frame = JSON.parse(String(e.data));
  if (frame.t !== "msg" || frame.src !== BENCH_PREFIX) return;
  const start = sentAt.get(frame.body.text);
  if (start !== undefined) {
    const ms = performance.now() - start;
    delays.push(ms);
    // 交互模式逐条打印往返延迟
    if (interactive) console.log(`  ← 收到 (往返 ${ms.toFixed(0)}ms): ${frame.body.text}`);
  }
};

let pending = 0;
async function send(text) {
  sentAt.set(text, performance.now());
  pending++;
  await fetch(new URL("/api/send", base), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify({ src: BENCH_PREFIX, body: { kind: "text", text } }),
  }).catch((err) => console.error("发送失败:", err.message)).finally(() => pending--);
}

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = (e) => reject(new Error(`WebSocket 连接失败: ${e?.message ?? e}`));
});

if (interactive) {
  await runInteractive();
} else {
  await runBatch();
}

function summary() {
  delays.sort((a, b) => a - b);
  const pick = (p) => delays[Math.min(delays.length - 1, Math.floor(delays.length * p))] ?? NaN;
  console.log(`收到 ${delays.length}/${count}`);
  console.log(`p50 ${pick(0.5).toFixed(0)}ms  p95 ${pick(0.95).toFixed(0)}ms  max ${pick(1).toFixed(0)}ms`);
}

async function runBatch() {
  const jitterNote = jitter > 0 ? `+0~${jitter}ms 抖动` : "";
  console.log(`已连接, 开始发送 ${count} 条, 间隔 ${interval}ms${jitterNote}。`);
  for (let i = 0; i < count; i++) {
    await send(`${BENCH_PREFIX}-${Date.now()}-${i}`);
    const wait = interval + (jitter > 0 ? Math.random() * jitter : 0);
    await new Promise((r) => setTimeout(r, wait));
  }
  const deadline = Date.now() + TIMEOUT_MS;
  while ((delays.length < count || pending > 0) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  ws.close();
  summary();
  process.exit(0);
}

// 用 line 事件逐行处理, TTY 逐行输入与管道全量输入都可靠 (readline.question 在非 TTY 下会 hang)
function runInteractive() {
  console.log("交互模式: 输入内容回车发送, 输入 exit 退出。");
  const rl = createInterface({ input, output, terminal: input.isTTY });
  if (input.isTTY) rl.setPrompt("> "), rl.prompt();
  let seq = 0;
  let closed = false;
  const finish = async () => {
    if (closed) return;
    closed = true;
    rl.close();
    // 等在途发送全部落地, 避免最后几条被掐掉
    while (pending > 0) await new Promise((r) => setTimeout(r, 30));
    // 再给回显一点时间
    await new Promise((r) => setTimeout(r, 300));
    ws.close();
    console.log(`已退出, 共发送 ${seq} 条。`);
    process.exit(0);
  };
  rl.on("line", (raw) => {
    const line = raw.trim();
    if (line === "exit" || line === "quit") return finish();
    if (line) send(`${BENCH_PREFIX}-${Date.now()}-${seq++}: ${line}`);
    if (input.isTTY) rl.prompt();
  });
  rl.on("close", finish); // Ctrl+D
}
