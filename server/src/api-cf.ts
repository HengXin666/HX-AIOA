import { PATH_CF_USAGE } from "@hx-aioa/protocol";
import { GET, WORKER_DAY_LIMIT } from "./constants";
import { cfCached } from "./cf-cache";
import { rest } from "./api-cf-storage";
import type { Env } from "./env";
import { OWNER, type Route, route } from "./core";
import { fail, json } from "./http";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const CACHE_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
const ROWS = 100;

// 免费计划每日额度 (UTC 0 点重置), 见 docs/deploy/cf-usage.md
export const CF_LIMITS = [
  { key: "workerRequests", label: "Worker 请求", limit: WORKER_DAY_LIMIT, unit: "次" },
  { key: "doRequests", label: "DO 请求 (原始计数, 偏保守)", limit: 100_000, unit: "次" },
  { key: "doDuration", label: "DO 时长", limit: 13_000, unit: "GB-s" },
  { key: "rowsWritten", label: "行写入", limit: 100_000, unit: "行" },
  { key: "rowsRead", label: "行读取", limit: 5_000_000, unit: "行" },
] as const;

// DO 存储: 免费计划共 5 GB, 不按天重置
export const CF_STORAGE_LIMIT = 5 * 1024 ** 3;

export type CfUsage = {
  configured: boolean;
  at?: number;
  day?: string;
  // by: 按 worker 拆开的用量 (从大到小); 拆不了的项没有 by
  items?: { key: string; label: string; used: number; limit: number; unit: string; by?: { name: string; used: number }[] }[];
  split?: string;
  // storedBytes: 整个账号 DO 存储 (CF 统计, 有延迟); hubBytes: 主 Hub 数据库当前大小 (实时)
  storage?: { storedBytes?: number; limit: number; hubBytes?: number; error?: string };
};

const STORAGE_QUERY = `query($a: String!, $d: Date!) { viewer { accounts(filter: {accountTag: $a}) {
  durableObjectsStorageGroups(limit: 31, filter: {date_geq: $d}, orderBy: [date_DESC]) { dimensions { date } max { storedBytes } }
} } }`;

const QUERY = `query($a: String!, $s: Time!, $e: Time!) { viewer { accounts(filter: {accountTag: $a}) {
  workersInvocationsAdaptive(limit: ${ROWS}, filter: {datetime_geq: $s, datetime_leq: $e}) { sum { requests } }
  durableObjectsInvocationsAdaptiveGroups(limit: ${ROWS}, filter: {datetime_geq: $s, datetime_leq: $e}) { sum { requests } }
  durableObjectsPeriodicGroups(limit: ${ROWS}, filter: {datetime_geq: $s, datetime_leq: $e}) { sum { duration rowsRead rowsWritten } }
} } }`;

// 按 worker 拆: 请求按 scriptName 分组; DO 时长 / 行读写只能按命名空间分组, 再用命名空间列表对回 worker
const SPLIT_QUERY = `query($a: String!, $s: Time!, $e: Time!) { viewer { accounts(filter: {accountTag: $a}) {
  workersInvocationsAdaptive(limit: ${ROWS}, filter: {datetime_geq: $s, datetime_leq: $e}) { sum { requests } dimensions { scriptName } }
  durableObjectsInvocationsAdaptiveGroups(limit: ${ROWS}, filter: {datetime_geq: $s, datetime_leq: $e}) { sum { requests } dimensions { scriptName } }
  durableObjectsPeriodicGroups(limit: ${ROWS}, filter: {datetime_geq: $s, datetime_leq: $e}) { sum { duration rowsRead rowsWritten } dimensions { namespaceId } }
} } }`;
const NS_SHORT = 6;

type Sum = Record<string, number | undefined>;
type DimGroups = { sum: Sum; dimensions?: Record<string, string | undefined> }[] | undefined;

/** 按维度累加成 名字 -> 用量, 名字由 nameOf 决定。 */
function byDim(g: DimGroups, k: string, dim: string, nameOf: (v: string) => string): { name: string; used: number }[] {
  const m = new Map<string, number>();
  for (const r of g ?? []) {
    const name = nameOf(r.dimensions?.[dim] ?? "");
    m.set(name, (m.get(name) ?? 0) + (r.sum[k] ?? 0));
  }
  return [...m].map(([name, used]) => ({ name, used: Math.round(used) })).filter((x) => x.used > 0).sort((a, b) => b.used - a.used);
}

type Namespace = { id: string; script?: string; name?: string };

async function splitUsage(env: Env, vars: Record<string, string>): Promise<Record<string, { name: string; used: number }[]>> {
  const [data, ns] = await Promise.all([
    gql<{ viewer?: { accounts?: Record<string, DimGroups>[] } }>(env, SPLIT_QUERY, vars),
    rest<Namespace[]>(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/durable_objects/namespaces?per_page=100`).catch(() => [] as Namespace[]),
  ]);
  const acc = data.viewer?.accounts?.[0] ?? {};
  const script = (v: string) => v || "其他";
  const nsName = (v: string) => ns.find((n) => n.id === v)?.script ?? (v ? `命名空间 ${v.slice(0, NS_SHORT)}` : "其他");
  const periodic = acc.durableObjectsPeriodicGroups;
  return {
    workerRequests: byDim(acc.workersInvocationsAdaptive, "requests", "scriptName", script),
    doRequests: byDim(acc.durableObjectsInvocationsAdaptiveGroups, "requests", "scriptName", script),
    doDuration: byDim(periodic, "duration", "namespaceId", nsName),
    rowsWritten: byDim(periodic, "rowsWritten", "namespaceId", nsName),
    rowsRead: byDim(periodic, "rowsRead", "namespaceId", nsName),
  };
}
type Groups = { sum: Sum }[] | undefined;
const total = (g: Groups, k: string) => (g ?? []).reduce((n, r) => n + (r.sum[k] ?? 0), 0);

const CACHE_KEY = "usage";

export async function gql<T>(env: Env, query: string, variables: Record<string, string | string[]>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.CF_API_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || body.errors?.length || !body.data) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return body.data;
}

type StorageData = { viewer?: { accounts?: { durableObjectsStorageGroups?: { max: { storedBytes?: number } }[] }[] } };

const STORAGE_DAYS = 30;

// 存储另查一次: 失败不影响用量
async function storedBytes(env: Env, now: number): Promise<{ storedBytes?: number; error?: string }> {
  const day = new Date(now - DAY_MS * STORAGE_DAYS).toISOString().slice(0, 10);
  try {
    const d = await gql<StorageData>(env, STORAGE_QUERY, { a: env.CF_ACCOUNT_ID!, d: day });
    const rows = d.viewer?.accounts?.[0]?.durableObjectsStorageGroups ?? [];
    return rows.length ? { storedBytes: rows[0]!.max.storedBytes } : { error: "CF 暂无存储统计" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function cfUsage(env: Env, now = Date.now(), hubBytes?: number): Promise<CfUsage> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { configured: false };
  const live = (b: CfUsage): CfUsage => ({ ...b, storage: { limit: CF_STORAGE_LIMIT, ...b.storage, hubBytes } });
  return live(await cfCached(CACHE_KEY, CACHE_MS, now, () => loadUsage(env, now)));
}

async function loadUsage(env: Env, now: number): Promise<CfUsage> {
  const start = new Date(Math.floor(now / DAY_MS) * DAY_MS);
  const vars = { a: env.CF_ACCOUNT_ID!, s: start.toISOString(), e: new Date(now).toISOString() };
  let split: string | undefined;
  const [data, stored, parts] = await Promise.all([
    gql<{ viewer?: { accounts?: Record<string, Groups>[] } }>(env, QUERY, vars),
    storedBytes(env, now),
    // 拆分失败不影响总量
    splitUsage(env, vars).catch((e) => ((split = e instanceof Error ? e.message : String(e)), undefined)),
  ]);
  const acc = data.viewer?.accounts?.[0] ?? {};
  const used: Record<string, number> = {
    workerRequests: total(acc.workersInvocationsAdaptive, "requests"),
    doRequests: total(acc.durableObjectsInvocationsAdaptiveGroups, "requests"),
    doDuration: Math.round(total(acc.durableObjectsPeriodicGroups, "duration")),
    rowsWritten: total(acc.durableObjectsPeriodicGroups, "rowsWritten"),
    rowsRead: total(acc.durableObjectsPeriodicGroups, "rowsRead"),
  };
  const items = CF_LIMITS.map((l) => {
    const by = parts?.[l.key];
    return { ...l, used: used[l.key] ?? 0, ...(by?.length ? { by } : {}) };
  });
  const out: CfUsage = { configured: true, at: now, day: start.toISOString().slice(0, 10), items, storage: { limit: CF_STORAGE_LIMIT, ...stored } };
  if (split) out.split = split;
  return out;
}

export const CF_ROUTES: Route[] = [
  route(GET, PATH_CF_USAGE, OWNER, async (c) => {
    try {
      return json(await cfUsage(c.core.env, Date.now(), c.core.dbSize()));
    } catch (e) {
      return fail(502, `查询 CF 用量失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }),
];
