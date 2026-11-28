#!/usr/bin/env node
// 懒更新探针: 平时只低频记本地历史, 服务端下发 demand 后才实时推送。
// 环境变量: AIOA_SERVER (如 https://example.com), AIOA_TOKEN, AIOA_SUBJECT (默认主机名)
// 告警阈值: AIOA_ALERT_CPU / AIOA_ALERT_MEM (百分比, 默认 90), AIOA_ALERT_TEMP (摄氏度, 默认 85), 设为 0 关闭
// 主机卡片: AIOA_SNAPSHOT_MIN 分钟发一次快照 (默认 10), AIOA_IP 覆盖显示的 IP
// 终端: AIOA_SHELL=1 才开启 (还要 key 带 probe:shell 权限, App 端每次输入密码), 需要 python3
// Agent GUI: AIOA_AGENT=1 才加载 probe-agent.mjs (还要 key 带 probe:agent), 直连监听 AIOA_AGENT_LISTEN
import os from "node:os";
import { readFileSync, statfsSync } from "node:fs";

const IDLE_SAMPLE_MS = 60_000;
const HISTORY_POINTS = 1440;
const PING_MS = 30_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;
const DEVICE_PREFIX = "probe";
const MEMINFO = "/proc/meminfo";
const THERMAL = "/sys/class/thermal/thermal_zone0/temp";
const NET_DEV = "/proc/net/dev";
const OS_RELEASE = "/etc/os-release";
const ROOT = "/";
const KB = 1024;
const SNAPSHOT_MS = envNumber("AIOA_SNAPSHOT_MIN", 10) * 60_000;
const ALERT_SUSTAIN = 3;
const SEND_PATH = "/api/send";
// 带上自定义 UA, 避免被 CF 的机器人防护拦下
const AGENT_UA = "hx-aioa-agent/1";
const SHELL_ON = process.env.AIOA_SHELL === "1";
const AGENT_ON = process.env.AIOA_AGENT === "1";
const ALERTS = [
  { key: "cpu", name: "CPU", unit: "%", limit: envNumber("AIOA_ALERT_CPU", 90) },
  { key: "mem", name: "内存", unit: "%", limit: envNumber("AIOA_ALERT_MEM", 90) },
  { key: "temp", name: "温度", unit: "°C", limit: envNumber("AIOA_ALERT_TEMP", 85) },
];

function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" && process.env[name] !== undefined ? v : fallback;
}

const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
const subject = process.env.AIOA_SUBJECT || os.hostname();
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}

const history = [];
let lastCpu = cpuTimes();
let ws;
let live;
let retry = RETRY_MIN_MS;

function cpuTimes() {
  return os.cpus().reduce(
    (a, c) => {
      const t = c.times;
      a.idle += t.idle;
      a.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return a;
    },
    { idle: 0, total: 0 },
  );
}

function cpuPercent() {
  const now = cpuTimes();
  const total = now.total - lastCpu.total;
  const idle = now.idle - lastCpu.idle;
  lastCpu = now;
  return total > 0 ? round((1 - idle / total) * 100) : 0;
}

function memPercent() {
  try {
    const info = readFileSync(MEMINFO, "utf8");
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(info)?.[1] ?? 0);
    const total = kb("MemTotal");
    if (total > 0) return round((1 - kb("MemAvailable") / total) * 100);
  } catch {}
  return round((1 - os.freemem() / os.totalmem()) * 100);
}

function temperature() {
  try {
    return round(Number(readFileSync(THERMAL, "utf8")) / 1000);
  } catch {
    return undefined;
  }
}

const round = (v) => Math.round(v * 10) / 10;

// 所有非回环网卡的累计字节, 两次采样相减得到速率
function netBytes() {
  try {
    let rx = 0;
    let tx = 0;
    for (const line of readFileSync(NET_DEV, "utf8").split("\n").slice(2)) {
      const [name, rest] = line.split(":");
      if (!rest || name.trim() === "lo") continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0];
      tx += f[8];
    }
    return { rx, tx, ts: Date.now() };
  } catch {
    return undefined;
  }
}

let lastNet = netBytes();

function netRate() {
  const now = netBytes();
  const prev = lastNet;
  lastNet = now;
  if (!now || !prev || now.ts <= prev.ts) return undefined;
  const sec = (now.ts - prev.ts) / 1000;
  return { rx: round((now.rx - prev.rx) / KB / sec), tx: round((now.tx - prev.tx) / KB / sec) };
}

function diskPercent() {
  try {
    const s = statfsSync(ROOT);
    return s.blocks > 0 ? round((1 - s.bavail / s.blocks) * 100) : undefined;
  } catch {
    return undefined;
  }
}

function sample() {
  const values = { cpu: cpuPercent(), mem: memPercent(), load: round(os.loadavg()[0]) };
  const temp = temperature();
  if (temp !== undefined) values.temp = temp;
  const disk = diskPercent();
  if (disk !== undefined) values.disk = disk;
  const net = netRate();
  if (net) Object.assign(values, net);
  return { ts: Date.now(), values };
}

function osName() {
  try {
    return /^PRETTY_NAME="?([^"\n]+)/m.exec(readFileSync(OS_RELEASE, "utf8"))?.[1] ?? `${os.type()} ${os.release()}`;
  } catch {
    return `${os.type()} ${os.release()}`;
  }
}

function hostInfo() {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === "IPv4");
  const info = { hostname: os.hostname(), os: osName(), arch: os.arch(), cores: os.cpus().length, memTotal: os.totalmem(), bootAt: Date.now() - os.uptime() * 1000 };
  if (SHELL_ON) info.shell = true;
  if (agent) info.agent = agent.info();
  const ip = process.env.AIOA_IP || lan?.address;
  if (ip) info.ip = ip;
  try {
    const s = statfsSync(ROOT);
    info.diskTotal = s.blocks * s.bsize;
  } catch {}
  return info;
}

// 24 小时在线率与心跳条: 每分钟记一次 {时间, 是否在线, 最近一次 ping 往返毫秒}
const upTicks = [];
const STARTED = Date.now();
const BEAT_SLOTS = 60;
const BEAT_SLOT_MS = 24 * 60_000;
const SLOW_RTT_MS = 1500;
let rtt = 0;
let pingAt = 0;

function availability() {
  return upTicks.length ? round((upTicks.filter((t) => t.up).length / upTicks.length) * 100) : 100;
}

// 每格 24 分钟, 共 24 小时: 有一次没连上记 r, 往返超过 1.5 秒记 y, 否则 g; 探针启动前的格子记 n
function beats(now) {
  let out = "";
  for (let i = BEAT_SLOTS - 1; i >= 0; i--) {
    const end = now - i * BEAT_SLOT_MS;
    const start = end - BEAT_SLOT_MS;
    if (end <= STARTED) {
      out += "n";
      continue;
    }
    const ticks = upTicks.filter((t) => t.ts > start && t.ts <= end);
    if (ticks.some((t) => !t.up)) out += "r";
    else if (ticks.some((t) => t.rtt > SLOW_RTT_MS)) out += "y";
    else out += "g";
  }
  return out;
}

function sendHost() {
  const now = Date.now();
  send({ t: "host", subject, info: hostInfo(), last: history[history.length - 1], avail: availability(), beats: beats(now), beatsAt: now });
}

function sendPing() {
  if (ws.readyState !== WebSocket.OPEN) return;
  pingAt = Date.now();
  ws.send("ping");
}

function remember(point) {
  history.push(point);
  if (history.length > HISTORY_POINTS) history.shift();
}

// 告警在本地判断: 连续 ALERT_SUSTAIN 个低频采样超限才发, 恢复后再发一条, 中间不重复
const breach = new Map();
const firing = new Set();

function checkAlerts(point) {
  for (const a of ALERTS) {
    const v = point.values[a.key];
    if (!a.limit || v === undefined) continue;
    const n = v > a.limit ? (breach.get(a.key) ?? 0) + 1 : 0;
    breach.set(a.key, n);
    if (n >= ALERT_SUSTAIN && !firing.has(a.key)) {
      firing.add(a.key);
      notify(`${a.name} 连续 ${ALERT_SUSTAIN} 分钟高于 ${a.limit}${a.unit} (当前 ${v}${a.unit})`);
    } else if (n === 0 && firing.has(a.key)) {
      firing.delete(a.key);
      notify(`${a.name} 已恢复 (当前 ${v}${a.unit})`);
    }
  }
}

async function notify(text) {
  console.log(`告警: ${text}`);
  try {
    const res = await fetch(new URL(SEND_PATH, server), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": AGENT_UA },
      body: JSON.stringify({ src: `${DEVICE_PREFIX}-${subject}`, body: { kind: "text", text } }),
    });
    if (!res.ok) console.error(`告警发送失败: HTTP ${res.status}`);
  } catch (e) {
    console.error(`告警发送失败: ${e.message}`);
  }
}

function send(frame) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function onDemand(frame) {
  clearInterval(live);
  live = undefined;
  if (!frame.subjects.includes(subject)) {
    console.log("没人在看, 停止实时推送");
    return;
  }
  console.log(`有人在看, 每 ${frame.intervalMs}ms 推送`);
  send({ t: "metric", subject, points: history, history: true });
  live = setInterval(() => send({ t: "metric", subject, points: [sample()] }), frame.intervalMs);
}

function connect() {
  const url = new URL("/ws", server.replace(/^http/, "ws"));
  url.searchParams.set("token", token);
  url.searchParams.set("device", `${DEVICE_PREFIX}-${subject}`);
  ws = new WebSocket(url, { headers: { "User-Agent": AGENT_UA } });
  let ping;
  ws.onopen = () => {
    retry = RETRY_MIN_MS;
    console.log(`已连接, 提供主体 ${subject}`);
    send({ t: "offer", subjects: [subject] });
    sendHost();
    agent?.onConnect();
    sendPing();
    ping = setInterval(sendPing, PING_MS);
  };
  ws.onmessage = (e) => {
    if (e.data === "pong") {
      if (pingAt) rtt = Date.now() - pingAt;
      pingAt = 0;
      return;
    }
    const frame = JSON.parse(e.data);
    if (frame.t === "demand") onDemand(frame);
    else if (frame.t?.startsWith("term")) term?.handle(frame);
    else if (frame.t?.startsWith("ag_")) agent?.handle(frame);
  };
  ws.onclose = () => {
    term?.closeAll();
    pingAt = 0;
    clearInterval(ping);
    clearInterval(live);
    live = undefined;
    console.log(`连接断开, ${retry / 1000}s 后重连`);
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, RETRY_MAX_MS);
  };
  ws.onerror = () => {};
}

function tick() {
  const point = sample();
  remember(point);
  checkAlerts(point);
  // 发出的 ping 超过一个周期还没回, 按慢处理
  const pending = pingAt ? Date.now() - pingAt : 0;
  upTicks.push({ ts: Date.now(), up: ws?.readyState === WebSocket.OPEN, rtt: Math.max(rtt, pending) });
  if (upTicks.length > HISTORY_POINTS) upTicks.shift();
}

const term = SHELL_ON ? (await import("./probe-term.mjs")).createTerminals(send) : null;
if (SHELL_ON) console.log("终端已开启 (AIOA_SHELL=1)");
const agent = AGENT_ON ? await (await import("./probe-agent.mjs")).createAgent({ send, subject }) : null;
// Agent 子进程是独立进程组, 探针退出时一并结束
if (agent) for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (agent.close(), process.exit(0)));
remember(sample());
setInterval(tick, IDLE_SAMPLE_MS);
setInterval(sendHost, SNAPSHOT_MS);
connect();
