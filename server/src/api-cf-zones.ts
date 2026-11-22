import { PATH_CF_ZONES } from "@hx-aioa/protocol";
import { GET } from "./constants";
import type { Env } from "./env";
import { OWNER, type Route, route } from "./core";
import { fail, json } from "./http";
import { gql } from "./api-cf";

// CF 总览: 按根域名 (zone) 看流量, 再看域名下挂的服务 (Worker / Pages); 见 docs/cf-usage.md
const REST = "https://api.cloudflare.com/client/v4";
const CACHE_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const RANGES = { "1d": 1, "7d": 7 } as const;
export type CfRange = keyof typeof RANGES;
const HOSTS = 30;
const COUNTRIES = 6;
const WORKERS = 50;
const ZONES_PER_QUERY = 10;

export type CfPoint = { t: string; req: number; cached: number; threats: number; bytes: number };
export type CfService = { kind: "worker" | "pages"; name: string };
export type CfHost = { host: string; req: number; bytes: number; err: number; service?: CfService };
export type CfZone = {
  id: string;
  name: string;
  plan?: string;
  req: number;
  cached: number;
  bytes: number;
  threats: number;
  status: Record<string, number>;
  countries: { name: string; req: number }[];
  series: CfPoint[];
  hosts: CfHost[];
  hostsError?: string;
};
export type CfWorker = { name: string; req: number; err: number; sub: number; cpuP50: number; cpuP99: number; hosts: string[] };
export type CfZones = {
  configured: boolean;
  at?: number;
  range?: CfRange;
  zones?: CfZone[];
  workers?: CfWorker[];
  // 没有 Workers/Pages 读取权限时为空, 域名就不标服务
  servicesError?: string;
};

type Rest<T> = { success: boolean; result?: T; errors?: { message: string }[] };

async function rest<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(REST + path, { headers: { authorization: `Bearer ${env.CF_API_TOKEN}` } });
  const body = (await res.json()) as Rest<T>;
  if (!res.ok || !body.success || body.result === undefined) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return body.result;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// 路由 "a.example.com/*" 取主机名; 带通配的主机名原样保留, 匹配时按后缀
const routeHost = (pattern: string) => pattern.replace(/^https?:\/\//, "").split("/")[0] ?? "";

type ServiceRule = { host: string; service: CfService };

async function serviceRules(env: Env): Promise<ServiceRule[]> {
  const a = env.CF_ACCOUNT_ID!;
  const [scripts, domains, pages] = await Promise.all([
    rest<{ id: string; routes?: { pattern: string }[] }[]>(env, `/accounts/${a}/workers/scripts`),
    rest<{ hostname: string; service: string }[]>(env, `/accounts/${a}/workers/domains`).catch(() => []),
    rest<{ name: string; domains?: string[] }[]>(env, `/accounts/${a}/pages/projects`).catch(() => []),
  ]);
  const out: ServiceRule[] = [];
  for (const s of scripts) for (const r of s.routes ?? []) out.push({ host: routeHost(r.pattern), service: { kind: "worker", name: s.id } });
  for (const d of domains) out.push({ host: d.hostname, service: { kind: "worker", name: d.service } });
  for (const p of pages) for (const h of p.domains ?? []) out.push({ host: h, service: { kind: "pages", name: p.name } });
  return out;
}

export function matchService(host: string, rules: ServiceRule[]): CfService | undefined {
  const exact = rules.find((r) => r.host === host);
  if (exact) return exact.service;
  return rules.find((r) => r.host.startsWith("*") && host.endsWith(r.host.slice(1)))?.service;
}

const statusClass = (code: number) => (code >= 100 && code < 600 ? `${Math.floor(code / 100)}xx` : "其他");

type Agg = {
  sum: { requests: number; bytes: number; cachedRequests: number; threats: number; responseStatusMap?: { edgeResponseStatus: number; requests: number }[]; countryMap?: { clientCountryName: string; requests: number }[] };
  dimensions: { t: string };
};
type HostRow = { count: number; sum: { edgeResponseBytes: number }; dimensions: { clientRequestHTTPHost: string; edgeResponseStatus: number } };
type ZoneData = { zoneTag: string; agg?: Agg[]; hosts?: HostRow[] };

const SUM = "sum { requests bytes cachedRequests threats responseStatusMap { edgeResponseStatus requests } countryMap { clientCountryName requests } }";

// 1 天按小时, 7 天按天; 这两张聚合表免费计划都可查
function zoneQuery(range: CfRange): string {
  const agg = range === "1d"
    ? `agg: httpRequests1hGroups(limit: 48, filter: {datetime_geq: $s, datetime_lt: $e}, orderBy: [datetime_ASC]) { ${SUM} dimensions { t: datetime } }`
    : `agg: httpRequests1dGroups(limit: 14, filter: {date_geq: $sd, date_leq: $ed}, orderBy: [date_ASC]) { ${SUM} dimensions { t: date } }`;
  return `query($z: [String!], $s: Time!, $e: Time!, $sd: Date!, $ed: Date!) { viewer { zones(filter: {zoneTag_in: $z}) { zoneTag ${agg} } } }`;
}

// 按主机名拆分只能用 adaptive 表, 单独查: 它失败不影响上面的总量
const HOST_QUERY = `query($z: [String!], $s: Time!, $e: Time!) { viewer { zones(filter: {zoneTag_in: $z}) { zoneTag
  hosts: httpRequestsAdaptiveGroups(limit: ${HOSTS * 4}, filter: {datetime_geq: $s, datetime_lt: $e, requestSource: "eyeball"}, orderBy: [count_DESC]) { count sum { edgeResponseBytes } dimensions { clientRequestHTTPHost edgeResponseStatus } }
} } }`;

const WORKER_QUERY = `query($a: String!, $s: Time!, $e: Time!) { viewer { accounts(filter: {accountTag: $a}) {
  workersInvocationsAdaptive(limit: ${WORKERS}, filter: {datetime_geq: $s, datetime_lt: $e}, orderBy: [sum_requests_DESC]) { sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { scriptName } }
} } }`;

type ZonesResp = { viewer?: { zones?: ZoneData[] } };

function foldZone(z: { id: string; name: string; plan?: { name?: string } }, agg: Agg[], hostRows: HostRow[] | undefined, rules: ServiceRule[]): CfZone {
  const status: Record<string, number> = {};
  const countries = new Map<string, number>();
  let req = 0, cached = 0, bytes = 0, threats = 0;
  const series = agg.map((a) => {
    req += a.sum.requests; cached += a.sum.cachedRequests; bytes += a.sum.bytes; threats += a.sum.threats;
    for (const s of a.sum.responseStatusMap ?? []) status[statusClass(s.edgeResponseStatus)] = (status[statusClass(s.edgeResponseStatus)] ?? 0) + s.requests;
    for (const c of a.sum.countryMap ?? []) countries.set(c.clientCountryName, (countries.get(c.clientCountryName) ?? 0) + c.requests);
    return { t: a.dimensions.t, req: a.sum.requests, cached: a.sum.cachedRequests, threats: a.sum.threats, bytes: a.sum.bytes };
  });
  const hosts = new Map<string, CfHost>();
  for (const r of hostRows ?? []) {
    const h = r.dimensions.clientRequestHTTPHost;
    const cur = hosts.get(h) ?? { host: h, req: 0, bytes: 0, err: 0, service: matchService(h, rules) };
    cur.req += r.count; cur.bytes += r.sum.edgeResponseBytes;
    if (r.dimensions.edgeResponseStatus >= 500) cur.err += r.count;
    hosts.set(h, cur);
  }
  return {
    id: z.id, name: z.name, plan: z.plan?.name, req, cached, bytes, threats, status, series,
    countries: [...countries].sort((a, b) => b[1] - a[1]).slice(0, COUNTRIES).map(([name, n]) => ({ name, req: n })),
    hosts: [...hosts.values()].sort((a, b) => b.req - a.req).slice(0, HOSTS),
  };
}

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const cache = new Map<CfRange, { at: number; body: CfZones }>();

export async function cfZones(env: Env, range: CfRange, now = Date.now()): Promise<CfZones> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { configured: false };
  const hit = cache.get(range);
  if (hit && now - hit.at < CACHE_MS) return hit.body;
  const days = RANGES[range];
  const end = new Date(Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS);
  const start = new Date(end.getTime() - days * DAY_MS);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const vars = { s: start.toISOString(), e: end.toISOString(), sd: day(new Date(end.getTime() - (days - 1) * DAY_MS - HOUR_MS)), ed: day(new Date(end.getTime() - HOUR_MS)) };
  // 主机名拆分最多看最近 1 天: adaptive 表单次查询跨度有限
  const hostVars = { s: new Date(end.getTime() - DAY_MS).toISOString(), e: vars.e };
  const zoneList = await rest<{ id: string; name: string; plan?: { name?: string } }[]>(env, `/zones?account.id=${env.CF_ACCOUNT_ID}&per_page=50`);
  let servicesError: string | undefined;
  const rules = await serviceRules(env).catch((e) => ((servicesError = errText(e)), [] as ServiceRule[]));
  const aggBy = new Map<string, Agg[]>();
  const hostsBy = new Map<string, HostRow[]>();
  let hostsError: string | undefined;
  for (const group of chunks(zoneList.map((z) => z.id), ZONES_PER_QUERY)) {
    const [a, h] = await Promise.all([
      gql<ZonesResp>(env, zoneQuery(range), { z: group, ...vars }),
      gql<ZonesResp>(env, HOST_QUERY, { z: group, ...hostVars }).catch((e) => ((hostsError = errText(e)), {} as ZonesResp)),
    ]);
    for (const z of a.viewer?.zones ?? []) aggBy.set(z.zoneTag, z.agg ?? []);
    for (const z of h.viewer?.zones ?? []) hostsBy.set(z.zoneTag, z.hosts ?? []);
  }
  const zones = zoneList
    .map((z) => ({ ...foldZone(z, aggBy.get(z.id) ?? [], hostsBy.get(z.id), rules), hostsError }))
    .sort((a, b) => b.req - a.req);
  const workers = await cfWorkers(env, vars.s, vars.e, rules).catch(() => [] as CfWorker[]);
  const body: CfZones = { configured: true, at: now, range, zones, workers, servicesError };
  cache.set(range, { at: now, body });
  return body;
}

type WorkerRow = { sum: { requests: number; errors: number; subrequests: number }; quantiles: { cpuTimeP50: number; cpuTimeP99: number }; dimensions: { scriptName: string } };

async function cfWorkers(env: Env, s: string, e: string, rules: ServiceRule[]): Promise<CfWorker[]> {
  const d = await gql<{ viewer?: { accounts?: { workersInvocationsAdaptive?: WorkerRow[] }[] } }>(env, WORKER_QUERY, { a: env.CF_ACCOUNT_ID!, s, e });
  return (d.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []).map((w) => ({
    name: w.dimensions.scriptName,
    req: w.sum.requests,
    err: w.sum.errors,
    sub: w.sum.subrequests,
    cpuP50: w.quantiles.cpuTimeP50,
    cpuP99: w.quantiles.cpuTimeP99,
    hosts: rules.filter((r) => r.service.kind === "worker" && r.service.name === w.dimensions.scriptName).map((r) => r.host),
  }));
}

export const CF_ZONE_ROUTES: Route[] = [
  route(GET, PATH_CF_ZONES, OWNER, async (c) => {
    const r = c.url.searchParams.get("range");
    const range: CfRange = r === "7d" ? "7d" : "1d";
    try {
      return json(await cfZones(c.core.env, range));
    } catch (e) {
      return fail(502, `查询 CF 总览失败: ${errText(e)}`);
    }
  }),
];
