import { FIELD_CPU, FIELD_UP, canonicalField, normalizeMetricValues, type EventInput, type MetricSource } from "@hx-aioa/protocol";
import { type Adapter, isObj, s } from "./types";

const PERCENT_SCALE = 100;
const NETDATA_CPU = "system.cpu";
const NETDATA_RAM = "system.ram";
const NETDATA_LOAD = "system.load";
const NETDATA_DISK = "disk_space._";
const DIM_USED = "used";

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

export function metricEvent(subject: string, values: Record<string, number>, source: MetricSource, ts?: number): EventInput {
  const out: EventInput = { kind: "metric", subject, data: { values: normalizeMetricValues(values, source) } };
  if (ts) out.ts = ts;
  return out;
}

// Beszel PocketBase 的 systems 记录 (GET /api/collections/systems/records 的 items 逐条推送)
export function beszelSystem(body: Record<string, unknown>, fallback?: string): EventInput[] | string {
  const info = isObj(body.info) ? body.info : {};
  const subject = s(body.name) || fallback;
  if (!subject) return "Beszel 记录缺少 name";
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(info)) {
    const n = num(v);
    // info 里还有核数, 运行时长等非指标字段, 只取认识的
    if (n !== undefined && (k === FIELD_CPU || canonicalField(k, "beszel") !== k)) values[k] = n;
  }
  if (body.status !== undefined) values[FIELD_UP] = s(body.status) === "up" ? 1 : 0;
  return Object.keys(values).length ? [metricEvent(subject, values, "beszel")] : "Beszel 记录里没有可用的指标";
}

type Dims = Record<string, { value?: unknown }>;
const dimsOf = (chart: unknown): Dims => (isObj(chart) && isObj(chart.dimensions) ? (chart.dimensions as Dims) : {});
const dim = (d: Dims, k: string) => num(d[k]?.value) ?? 0;
const sumDims = (d: Dims, skip: string[] = []) => Object.entries(d).filter(([k]) => !skip.includes(k)).reduce((a, [, v]) => a + (num(v.value) ?? 0), 0);

// Netdata /api/v1/allmetrics?format=json 整体推送: 按维度汇总成百分比
export const netdata: Adapter = ({ body, source }) => {
  if (!isObj(body)) return "Netdata 请求体必须是 allmetrics 的 JSON";
  const subject = source.subject ?? s(body.hostname);
  if (!subject) return "Netdata 需要在来源上配置 subject (主机名)";
  const values: Record<string, number> = {};
  if (isObj(body[NETDATA_CPU])) values[NETDATA_CPU] = sumDims(dimsOf(body[NETDATA_CPU]), ["idle"]);
  const ram = dimsOf(body[NETDATA_RAM]);
  const total = sumDims(ram);
  if (total > 0) values[NETDATA_RAM] = (dim(ram, DIM_USED) / total) * PERCENT_SCALE;
  if (isObj(body[NETDATA_LOAD])) values[NETDATA_LOAD] = dim(dimsOf(body[NETDATA_LOAD]), "load1");
  const disk = dimsOf(body[NETDATA_DISK]);
  const diskTotal = dim(disk, DIM_USED) + dim(disk, "avail");
  if (diskTotal > 0) values[NETDATA_DISK] = (dim(disk, DIM_USED) / diskTotal) * PERCENT_SCALE;
  return Object.keys(values).length ? [metricEvent(subject, values, "netdata")] : "Netdata 数据里没有 system.cpu / system.ram / system.load";
};

// Prometheus /api/v1/query 的 data.result 逐条推送: {metric:{...标签}, value:[秒, "数值"]}
export const prometheus: Adapter = ({ body, source }) => {
  if (!isObj(body) || !isObj(body.metric) || !Array.isArray(body.value)) return "Prometheus 条目需要 metric 与 value";
  const labels = body.metric;
  const instance = s(labels.instance).replace(/:\d+$/, "");
  const subject = s(labels.subject) || source.subject || instance;
  const field = s(labels.field) || canonicalField(s(labels.__name__), "prometheus");
  const value = num(body.value[1]);
  const sec = num(body.value[0]);
  if (!subject || !field || value === undefined) return "Prometheus 条目缺少 subject/field/数值";
  return [metricEvent(subject, { [field]: value }, "prometheus", sec ? Math.round(sec * 1000) : undefined)];
};
