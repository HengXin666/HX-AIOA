// 标准指标字段: 组件只绑定这些名字, 不关心数据来自哪个采集器, 换来源不用改布局
export const FIELD_CPU = "cpu";
export const FIELD_MEM = "mem";
export const FIELD_DISK = "disk";
export const FIELD_GPU = "gpu";
export const FIELD_TEMP = "temp";
export const FIELD_LOAD = "load";
export const FIELD_NET = "net";
export const FIELD_UP = "up";
export const FIELD_RX = "rx";
export const FIELD_TX = "tx";

const PERCENT = "%";

export type MetricFieldInfo = { name: string; unit: string };

export const METRIC_FIELDS: Record<string, MetricFieldInfo> = {
  [FIELD_CPU]: { name: "CPU", unit: PERCENT },
  [FIELD_MEM]: { name: "内存", unit: PERCENT },
  [FIELD_DISK]: { name: "磁盘", unit: PERCENT },
  [FIELD_GPU]: { name: "GPU", unit: PERCENT },
  [FIELD_TEMP]: { name: "温度", unit: "°C" },
  [FIELD_LOAD]: { name: "负载", unit: "" },
  [FIELD_NET]: { name: "网络", unit: "MB/s" },
  [FIELD_UP]: { name: "在线", unit: "" },
  [FIELD_RX]: { name: "下行", unit: "KB/s" },
  [FIELD_TX]: { name: "上行", unit: "KB/s" },
};

// 可替换的指标来源; 每个来源的原生字段名 → 标准字段名
export const METRIC_SOURCES = ["probe", "beszel", "netdata", "prometheus"] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

// 任何来源都通用的同义名, 兼容脚本直接 POST 的 metric 事件
const COMMON_ALIASES: Record<string, string> = {
  cpu_percent: FIELD_CPU,
  cpu_usage: FIELD_CPU,
  memory: FIELD_MEM,
  mem_percent: FIELD_MEM,
  memory_percent: FIELD_MEM,
  disk_percent: FIELD_DISK,
  temperature: FIELD_TEMP,
  load1: FIELD_LOAD,
  bandwidth: FIELD_NET,
  online: FIELD_UP,
};

export const METRIC_ALIASES: Record<MetricSource, Record<string, string>> = {
  probe: {},
  // Beszel systems 记录的 info 对象 (以实际版本为准)
  beszel: { mp: FIELD_MEM, dp: FIELD_DISK, dt: FIELD_TEMP, l1: FIELD_LOAD, g: FIELD_GPU, b: FIELD_NET },
  // Netdata 图表 id, 数值由适配器按维度汇总
  netdata: { "system.cpu": FIELD_CPU, "system.ram": FIELD_MEM, "system.load": FIELD_LOAD, "disk_space._": FIELD_DISK },
  // Prometheus 指标名; 其余指标建议在查询里用 label_replace 打上 field 标签
  prometheus: { node_load1: FIELD_LOAD, up: FIELD_UP, node_hwmon_temp_celsius: FIELD_TEMP },
};

export function canonicalField(name: string, source?: MetricSource): string {
  return (source ? METRIC_ALIASES[source][name] : undefined) ?? COMMON_ALIASES[name] ?? name;
}

// 原生名换成标准名; 同一个点里标准名与别名同时出现时以标准名为准
export function normalizeMetricValues(values: Record<string, number>, source?: MetricSource): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    const field = canonicalField(k, source);
    if (field !== k && field in values) continue;
    out[field] = v;
  }
  return out;
}

export function defaultUnits(values: Record<string, number>, units: Record<string, string> = {}): Record<string, string> {
  const out = { ...units };
  for (const k of Object.keys(values)) {
    const info = METRIC_FIELDS[k];
    if (out[k] === undefined && info?.unit) out[k] = info.unit;
  }
  return out;
}
