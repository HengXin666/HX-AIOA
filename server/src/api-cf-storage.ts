import { PATH_CF_STORAGE } from "@hx-aioa/protocol";
import { GET } from "./constants";
import type { Env } from "./env";
import { OWNER, type Route, route } from "./core";
import { fail, json } from "./http";
import { gql } from "./api-cf";

// CF 存储总览: R2 桶 / KV 命名空间 / D1 数据库的大小与本期用量, 对照免费额度; 见 docs/cf-usage.md
const REST = "https://api.cloudflare.com/client/v4";
const CACHE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 3;
const ROWS = 1000;
const GB = 1024 ** 3;

// 免费计划额度: R2 按月, KV/D1 按天 (UTC)
export const STORAGE_LIMITS = {
  r2Bytes: 10 * GB,
  r2ClassA: 1_000_000,
  r2ClassB: 10_000_000,
  kvBytes: 1 * GB,
  kvReads: 100_000,
  kvWrites: 1_000,
  d1Bytes: 5 * GB,
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
} as const;

// R2 操作分 A/B 两类计费; 删除免费
const R2_CLASS_A = new Set(["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "UploadPart", "UploadPartCopy", "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration", "ListMultipartUploads", "ListParts"]);
const R2_FREE = new Set(["DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload"]);
const KV_WRITES = new Set(["write", "delete", "list"]);

export type CfQuota = { key: string; label: string; used: number; limit: number; unit: "B" | "次" | "行"; period: "月" | "日" | "总" };
export type CfStore = { kind: "r2" | "kv" | "d1"; id: string; name: string; bytes: number; objects?: number; ops?: number };
export type CfStorage = { configured: boolean; at?: number; quotas?: CfQuota[]; stores?: CfStore[]; errors?: string[] };

type Rest<T> = { success: boolean; result?: T; errors?: { message: string }[] };
async function rest<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(REST + path, { headers: { authorization: `Bearer ${env.CF_API_TOKEN}` } });
  const body = (await res.json()) as Rest<T>;
  if (!res.ok || !body.success || body.result === undefined) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return body.result;
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Acc<T> = { viewer?: { accounts?: T[] } };
const first = <T>(d: Acc<T>) => d.viewer?.accounts?.[0];

const R2_QUERY = `query($a: String!, $s: Time!, $e: Time!, $ms: Time!) { viewer { accounts(filter: {accountTag: $a}) {
  size: r2StorageAdaptiveGroups(limit: ${ROWS}, filter: {datetime_geq: $s, datetime_leq: $e}, orderBy: [datetime_DESC]) { max { objectCount payloadSize metadataSize } dimensions { bucketName datetime } }
  ops: r2OperationsAdaptiveGroups(limit: ${ROWS}, filter: {datetime_geq: $ms, datetime_leq: $e}) { sum { requests } dimensions { actionType bucketName } }
} } }`;
type R2Data = {
  size?: { max: { objectCount: number; payloadSize: number; metadataSize: number }; dimensions: { bucketName: string } }[];
  ops?: { sum: { requests: number }; dimensions: { actionType: string; bucketName: string } }[];
};

const KV_QUERY = `query($a: String!, $s: Time!, $e: Time!, $ds: Time!) { viewer { accounts(filter: {accountTag: $a}) {
  size: kvStorageAdaptiveGroups(limit: ${ROWS}, filter: {datetime_geq: $s, datetime_leq: $e}, orderBy: [datetime_DESC]) { max { byteCount keyCount } dimensions { namespaceId datetime } }
  ops: kvOperationsAdaptiveGroups(limit: ${ROWS}, filter: {datetime_geq: $ds, datetime_leq: $e}) { sum { requests } dimensions { actionType namespaceId } }
} } }`;
type KvData = {
  size?: { max: { byteCount: number; keyCount: number }; dimensions: { namespaceId: string } }[];
  ops?: { sum: { requests: number }; dimensions: { actionType: string; namespaceId: string } }[];
};

const D1_QUERY = `query($a: String!, $ds: Time!, $e: Time!) { viewer { accounts(filter: {accountTag: $a}) {
  ops: d1AnalyticsAdaptiveGroups(limit: ${ROWS}, filter: {datetime_geq: $ds, datetime_leq: $e}) { sum { readQueries writeQueries rowsRead rowsWritten } dimensions { databaseId } }
} } }`;
type D1Data = { ops?: { sum: { readQueries: number; writeQueries: number; rowsRead: number; rowsWritten: number }; dimensions: { databaseId: string } }[] };

// 每个桶/命名空间只取最新一条大小
function latest<T, K extends string>(rows: T[] | undefined, key: (r: T) => K): Map<K, T> {
  const out = new Map<K, T>();
  for (const r of rows ?? []) if (!out.has(key(r))) out.set(key(r), r);
  return out;
}

const sumBy = <T>(rows: T[] | undefined, pick: (r: T) => number, pred: (r: T) => boolean = () => true) => (rows ?? []).filter(pred).reduce((n, r) => n + pick(r), 0);

let cache: { at: number; body: CfStorage } | null = null;

export async function cfStorage(env: Env, now = Date.now()): Promise<CfStorage> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { configured: false };
  if (cache && now - cache.at < CACHE_MS) return cache.body;
  const a = env.CF_ACCOUNT_ID;
  const d = new Date(now);
  const e = d.toISOString();
  const s = new Date(now - LOOKBACK_DAYS * DAY_MS).toISOString();
  const ds = new Date(Math.floor(now / DAY_MS) * DAY_MS).toISOString();
  const ms = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  const errors: string[] = [];
  const quotas: CfQuota[] = [];
  const stores: CfStore[] = [];
  const L = STORAGE_LIMITS;

  const [r2, kv, d1, kvNames, d1List] = await Promise.all([
    gql<Acc<R2Data>>(env, R2_QUERY, { a, s, e, ms }).then(first).catch((x) => void errors.push(`R2: ${errText(x)}`)),
    gql<Acc<KvData>>(env, KV_QUERY, { a, s, e, ds }).then(first).catch((x) => void errors.push(`KV: ${errText(x)}`)),
    gql<Acc<D1Data>>(env, D1_QUERY, { a, ds, e }).then(first).catch((x) => void errors.push(`D1: ${errText(x)}`)),
    rest<{ id: string; title: string }[]>(env, `/accounts/${a}/storage/kv/namespaces?per_page=100`).catch(() => []),
    rest<{ uuid: string; name: string; file_size?: number }[]>(env, `/accounts/${a}/d1/database?per_page=100`).catch((x) => (errors.push(`D1 列表: ${errText(x)}`), [])),
  ]);

  if (r2) {
    const size = latest(r2.size, (r) => r.dimensions.bucketName);
    let bytes = 0;
    for (const [name, r] of size) {
      const b = r.max.payloadSize + r.max.metadataSize;
      bytes += b;
      stores.push({ kind: "r2", id: name, name, bytes: b, objects: r.max.objectCount, ops: sumBy(r2.ops, (o) => o.sum.requests, (o) => o.dimensions.bucketName === name) });
    }
    const classA = sumBy(r2.ops, (o) => o.sum.requests, (o) => R2_CLASS_A.has(o.dimensions.actionType));
    const classB = sumBy(r2.ops, (o) => o.sum.requests, (o) => !R2_CLASS_A.has(o.dimensions.actionType) && !R2_FREE.has(o.dimensions.actionType));
    quotas.push(
      { key: "r2Bytes", label: "R2 存储", used: bytes, limit: L.r2Bytes, unit: "B", period: "总" },
      { key: "r2ClassA", label: "R2 A 类操作 (写/列)", used: classA, limit: L.r2ClassA, unit: "次", period: "月" },
      { key: "r2ClassB", label: "R2 B 类操作 (读)", used: classB, limit: L.r2ClassB, unit: "次", period: "月" },
    );
  }
  if (kv) {
    const names = new Map(kvNames.map((n) => [n.id, n.title]));
    const size = latest(kv.size, (r) => r.dimensions.namespaceId);
    let bytes = 0;
    for (const [id, r] of size) {
      bytes += r.max.byteCount;
      stores.push({ kind: "kv", id, name: names.get(id) ?? id, bytes: r.max.byteCount, objects: r.max.keyCount, ops: sumBy(kv.ops, (o) => o.sum.requests, (o) => o.dimensions.namespaceId === id) });
    }
    quotas.push(
      { key: "kvBytes", label: "KV 存储", used: bytes, limit: L.kvBytes, unit: "B", period: "总" },
      { key: "kvReads", label: "KV 读取", used: sumBy(kv.ops, (o) => o.sum.requests, (o) => o.dimensions.actionType === "read"), limit: L.kvReads, unit: "次", period: "日" },
      { key: "kvWrites", label: "KV 写/删/列", used: sumBy(kv.ops, (o) => o.sum.requests, (o) => KV_WRITES.has(o.dimensions.actionType)), limit: L.kvWrites, unit: "次", period: "日" },
    );
  }
  if (d1List.length || d1) {
    let bytes = 0;
    for (const db of d1List) {
      bytes += db.file_size ?? 0;
      const ops = (d1?.ops ?? []).filter((o) => o.dimensions.databaseId === db.uuid);
      stores.push({ kind: "d1", id: db.uuid, name: db.name, bytes: db.file_size ?? 0, ops: sumBy(ops, (o) => o.sum.readQueries + o.sum.writeQueries) });
    }
    quotas.push(
      { key: "d1Bytes", label: "D1 存储", used: bytes, limit: L.d1Bytes, unit: "B", period: "总" },
      { key: "d1RowsRead", label: "D1 行读取", used: sumBy(d1?.ops, (o) => o.sum.rowsRead), limit: L.d1RowsRead, unit: "行", period: "日" },
      { key: "d1RowsWritten", label: "D1 行写入", used: sumBy(d1?.ops, (o) => o.sum.rowsWritten), limit: L.d1RowsWritten, unit: "行", period: "日" },
    );
  }
  stores.sort((x, y) => y.bytes - x.bytes);
  const body: CfStorage = { configured: true, at: now, quotas, stores, errors: errors.length ? errors : undefined };
  cache = { at: now, body };
  return body;
}

export const CF_STORAGE_ROUTES: Route[] = [
  route(GET, PATH_CF_STORAGE, OWNER, async (c) => {
    try {
      return json(await cfStorage(c.core.env));
    } catch (e) {
      return fail(502, `查询 CF 存储失败: ${errText(e)}`);
    }
  }),
];
