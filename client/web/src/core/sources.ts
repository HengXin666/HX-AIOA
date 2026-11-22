import { HOOK_ADAPTERS, PATH_EVENTS, PATH_HOOKS, PATH_SOURCE_TYPES, type KeyCreated, type SourceCreated, type SourceInfo, type SourceInput, type SourceTypeInfo } from "@hx-aioa/protocol";
import { SERVER_URL, SOURCES_PATH } from "../constants";
import { api, json } from "./api";
import type { Mode } from "./backend";

export const GITHUB = "github";
const MOCK_ORIGIN = "https://aioa.example.com";
const MOCK_DELAY_MS = 300;

// 服务端不可用 (?mock=1) 时的类型表, 与服务端 SOURCE_TYPE_INFOS 保持同样的形状
const MOCK_TYPES: SourceTypeInfo[] = [
  { type: "webhook", adapter: "generic", name: "通用 Webhook", icon: "webhook", setup: "任意系统 POST JSON, 可在来源上配置 mapping 映射字段" },
  { type: "github", adapter: "github", name: "GitHub", icon: "github", setup: "仓库 Settings -> Webhooks, Content type 选 application/json, Secret 填 webhookSecret" },
  { type: "uptime-kuma", adapter: "uptime-kuma", name: "Uptime Kuma", icon: "activity", setup: "通知类型选 Webhook, 地址填 webhookUrls[\"uptime-kuma\"] 并带 ?key=" },
  { type: "healthchecks", adapter: "healthchecks", name: "Healthchecks", icon: "heart-pulse", setup: "Webhook 集成, 请求体见文档的推荐模板" },
  { type: "script", name: "脚本", icon: "terminal", setup: "POST /api/v1/events 或 /api/v1/messages" },
];

const mockSources = new Map<string, SourceInfo>();
// key 与 secret 只在创建时返回一次, 只留在本页内存里, 刷新即丢
const createdKeys = new Map<string, KeyCreated>();

const wait = <T>(v: T) => new Promise<T>((r) => window.setTimeout(() => r(v), MOCK_DELAY_MS));
const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const itemPath = (id: string) => `${SOURCES_PATH}/${encodeURIComponent(id)}`;

// GitHub 排第一, 其余保持服务端顺序
export async function sourceTypes(mode: Mode): Promise<SourceTypeInfo[]> {
  const list = mode === "live" ? (await api<{ types: SourceTypeInfo[] }>(PATH_SOURCE_TYPES)).types : MOCK_TYPES;
  return [...list].sort((a, b) => Number(b.type === GITHUB) - Number(a.type === GITHUB));
}

export async function listSources(mode: Mode): Promise<SourceInfo[]> {
  if (mode === "live") return (await api<{ sources: SourceInfo[] }>(SOURCES_PATH)).sources;
  return wait([...mockSources.values()]);
}

export async function getSource(mode: Mode, id: string): Promise<SourceInfo | null> {
  if (mode !== "live") return wait(mockSources.get(id) ?? null);
  return api<SourceInfo>(itemPath(id)).catch(() => null);
}

function mockCreated(input: SourceInput, t: SourceTypeInfo | undefined): SourceCreated {
  const id = `src_${rand()}`;
  const keyId = `k_${rand()}`;
  const info: SourceInfo = { id, userId: "owner", name: input.name, type: input.type, keyId, created: Date.now() };
  if (input.subject) info.subject = input.subject;
  if (t?.icon) info.icon = t.icon;
  mockSources.set(id, info);
  const webhookUrls = Object.fromEntries(HOOK_ADAPTERS.map((a) => [a, `${MOCK_ORIGIN}${PATH_HOOKS}/${a}/${keyId}`]));
  const key: KeyCreated = { id: keyId, userId: "owner", name: input.name, prefix: "aioa_mock", scopes: ["events:write"], channels: [], ratePerMin: 60, sourceId: id, created: Date.now(), key: `aioa_mock_${rand()}`, webhookSecret: `whs_mock_${rand()}`, webhookUrls };
  return { ...info, key };
}

export async function createSource(mode: Mode, input: SourceInput, t?: SourceTypeInfo): Promise<SourceCreated> {
  const out = mode === "live" ? await api<SourceCreated>(SOURCES_PATH, json("POST", { ...input, key: {} })) : await wait(mockCreated(input, t));
  if (out.key) createdKeys.set(out.id, out.key);
  return out;
}

export async function deleteSource(mode: Mode, id: string): Promise<void> {
  createdKeys.delete(id);
  if (mode === "live") await api(itemPath(id), { method: "DELETE" });
  else mockSources.delete(id);
}

export const createdKey = (id: string): KeyCreated | undefined => createdKeys.get(id);

// 没有适配器的来源直接调事件接口
export const eventsUrl = (): string => `${SERVER_URL || MOCK_ORIGIN}${PATH_EVENTS}`;

export function hookUrl(k: KeyCreated, t: SourceTypeInfo | undefined, withKey: boolean): string {
  const base = k.webhookUrls[t?.adapter ?? "generic"] ?? "";
  return withKey && base ? `${base}?key=${encodeURIComponent(k.key)}` : base;
}

// "github:owner/repo" 或 "owner/repo" 都取出 owner/repo
export function repoOf(subject: string | undefined): string {
  const m = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(subject?.trim() ?? "");
  return m?.[1] ?? "";
}
