import { severityFromText } from "@hx-aioa/protocol";
import { beszelSystem } from "./metrics";
import { type Adapter, CRITICAL, FIRING, INFO, RESOLVED, WARNING, event, hostOf, isObj, s } from "./types";

// Uptime Kuma: heartbeat.status 0 掉线, 1 恢复, 2 等待, 3 维护; 测试通知没有 heartbeat
export const uptimeKuma: Adapter = ({ body }) => {
  if (!isObj(body)) return "Uptime Kuma 请求体必须是 JSON";
  const hb = isObj(body.heartbeat) ? body.heartbeat : null;
  const mon = isObj(body.monitor) ? body.monitor : null;
  if (!hb || !mon) return [event(s(body.msg) || "Uptime Kuma 测试通知", INFO, { dedupeKey: "kuma:test" })];
  const name = s(mon.name) || "monitor";
  const host = s(mon.hostname) || hostOf(s(mon.url)) || name;
  const status = Number(hb.status);
  const ex = { subject: name, dedupeKey: `kuma:${s(mon.id) || name}`, groupKey: `host:${host}`, summary: s(hb.msg) || s(body.msg), url: s(mon.url) };
  if (status === 1) return [event(`${name} 已恢复`, INFO, { ...ex, status: RESOLVED })];
  if (status === 0) return [event(`${name} 不可用`, CRITICAL, { ...ex, status: FIRING })];
  if (status === 3) return [event(`${name} 维护中`, INFO, { ...ex, status: "ongoing" })];
  return [event(`${name} 状态待定`, WARNING, { ...ex, status: FIRING })];
};

const BESZEL_METRICS = ["cpu", "memory", "disk", "bandwidth", "temperature", "load", "gpu"];
const BESZEL_CONN = /connection to (\S+) is/i;
const BESZEL_ON = /\bon (\S+?)\.?$/i;

// Beszel 通过 shoutrrr 的 generic 地址发出 {title, message}, 标题形如 "CPU usage above threshold on nas" / "Connection to nas is down"
export const beszel: Adapter = ({ body, source }) => {
  if (!isObj(body)) return "Beszel 请求体必须是 JSON";
  // 拉取 systems 记录时带 info, 转成指标; 告警通知只有 title/message
  if (isObj(body.info)) return beszelSystem(body, source.subject);
  const title = s(body.title) || s(body.message) || "Beszel 告警";
  const message = s(body.message);
  const system = BESZEL_CONN.exec(title)?.[1] ?? BESZEL_ON.exec(title)?.[1] ?? source.subject ?? "beszel";
  const lower = title.toLowerCase();
  const metric = BESZEL_METRICS.find((k) => lower.includes(k)) ?? "status";
  const recovered = /\b(up|below|resolved|normal)\b/.test(lower);
  const severity = recovered ? INFO : /\bdown\b/.test(lower) ? CRITICAL : WARNING;
  const ex = { subject: system, dedupeKey: `beszel:${system}:${metric}`, groupKey: `host:${system}`, summary: message, status: recovered ? RESOLVED : FIRING } as const;
  return [event(title, severity, { ...ex })];
};

// Healthchecks: 推荐的请求体模板见 docs/api-v1.md, 也兼容表单与 query 形式的 $NAME / $STATUS
export const healthchecks: Adapter = ({ body }) => {
  if (!isObj(body)) return "Healthchecks 请求体必须是对象";
  const name = s(body.name) || s(body.check) || "check";
  const status = s(body.status).toLowerCase();
  const code = s(body.code) || name;
  const down = status === "down" || severityFromText(status) === CRITICAL;
  const ex = { subject: name, dedupeKey: `hc:${code}`, summary: [s(body.tags), s(body.now)].filter(Boolean).join(" "), url: s(body.url) };
  if (down) return [event(`${name} 未按时报到`, CRITICAL, { ...ex, status: FIRING })];
  return [event(`${name} 已恢复`, INFO, { ...ex, status: RESOLVED })];
};
