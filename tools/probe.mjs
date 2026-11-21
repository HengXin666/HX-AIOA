#!/usr/bin/env node
// 懒更新探针: 平时只低频记本地历史, 服务端下发 demand 后才实时推送。
// 环境变量: AIOA_SERVER (如 https://example.com), AIOA_TOKEN, AIOA_SUBJECT (默认主机名)
// 告警阈值: AIOA_ALERT_CPU / AIOA_ALERT_MEM (百分比, 默认 90), AIOA_ALERT_TEMP (摄氏度, 默认 85), 设为 0 关闭
import os from "node:os";
import { readFileSync } from "node:fs";

const IDLE_SAMPLE_MS = 60_000;
const HISTORY_POINTS = 1440;
const PING_MS = 30_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;
const DEVICE_PREFIX = "probe";
const MEMINFO = "/proc/meminfo";
const THERMAL = "/sys/class/thermal/thermal_zone0/temp";
const ALERT_SUSTAIN = 3;
const SEND_PATH = "/api/send";
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

function sample() {
  const values = { cpu: cpuPercent(), mem: memPercent(), load: round(os.loadavg()[0]) };
  const temp = temperature();
  if (temp !== undefined) values.temp = temp;
  return { ts: Date.now(), values };
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
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
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
  ws = new WebSocket(url);
  let ping;
  ws.onopen = () => {
    retry = RETRY_MIN_MS;
    console.log(`已连接, 提供主体 ${subject}`);
    send({ t: "offer", subjects: [subject] });
    ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
  };
  ws.onmessage = (e) => {
    if (e.data === "pong") return;
    const frame = JSON.parse(e.data);
    if (frame.t === "demand") onDemand(frame);
  };
  ws.onclose = () => {
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
}

remember(sample());
setInterval(tick, IDLE_SAMPLE_MS);
connect();
