// 延迟压测: 通过 HTTP 发消息, 用 WebSocket 收, 同一台机器计时, 不受时钟偏差影响
// 用法: node tools/bench.mjs --url https://域名 --token 令牌 [--count 50] [--interval 200] [--jitter 0]
//   --interval  每次发送的基础间隔 (ms)
//   --jitter    在基础间隔上叠加 0~jitter 的随机抖动 (ms), 模拟真实发送节奏

const DEFAULT_COUNT = 50;
const DEFAULT_INTERVAL_MS = 200;
const DEFAULT_JITTER_MS = 0;
const TIMEOUT_MS = 10_000;
const BENCH_PREFIX = "bench";
// woa.qzz.io 开了 Bot Fight/Managed Challenge, 非浏览器 UA 会被 403 拦截, 压测必须伪装成浏览器
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const base = arg("url");
const token = arg("token");
const count = Number(arg("count", DEFAULT_COUNT));
const interval = Number(arg("interval", DEFAULT_INTERVAL_MS));
const jitter = Math.max(0, Number(arg("jitter", DEFAULT_JITTER_MS)));
if (!base || !token) {
  console.error("缺少参数: --url 与 --token 必填。");
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
  if (start !== undefined) delays.push(performance.now() - start);
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const jitterNote = jitter > 0 ? `+0~${jitter}ms 抖动` : "";
console.log(`已连接, 开始发送 ${count} 条, 间隔 ${interval}ms${jitterNote}。`);

for (let i = 0; i < count; i++) {
  const text = `${BENCH_PREFIX}-${Date.now()}-${i}`;
  sentAt.set(text, performance.now());
  fetch(new URL("/api/send", base), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify({ src: BENCH_PREFIX, body: { kind: "text", text } }),
  }).catch((err) => console.error("发送失败:", err.message));
  const wait = interval + (jitter > 0 ? Math.random() * jitter : 0);
  await new Promise((r) => setTimeout(r, wait));
}

const deadline = Date.now() + TIMEOUT_MS;
while (delays.length < count && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 100));
}
ws.close();

delays.sort((a, b) => a - b);
const pick = (p) => delays[Math.min(delays.length - 1, Math.floor(delays.length * p))] ?? NaN;
console.log(`收到 ${delays.length}/${count}`);
console.log(`p50 ${pick(0.5).toFixed(0)}ms  p95 ${pick(0.95).toFixed(0)}ms  max ${pick(1).toFixed(0)}ms`);
