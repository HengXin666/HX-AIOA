import { GITHUB_API, GITHUB_USER_AGENT } from "../constants";
import { ApiFail } from "../http";

const GH_WEB = "https://github.com";
const JSON_TYPE = "application/json";
export const GH_CODE = "github";

export type GhRes = { status: number; body: unknown };

/** 调 GitHub REST; 非 2xx 抛 ApiFail, 状态码透传 (401 说明授权失效)。 */
export async function gh(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<GhRes> {
  const res = await fetch(GITHUB_API + path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": GITHUB_USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body !== undefined ? { "Content-Type": JSON_TYPE } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg = typeof body === "object" && body && "message" in body ? String((body as { message: unknown }).message) : text.slice(0, 200);
    throw new ApiFail(res.status === 401 ? 401 : res.status >= 500 ? 502 : res.status, GH_CODE, `GitHub ${res.status}: ${msg}`);
  }
  return { status: res.status, body };
}

export async function graphql(token: string, query: string): Promise<Record<string, unknown>> {
  const r = await gh(token, "/graphql", { method: "POST", body: { query } });
  const b = r.body as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (!b.data && b.errors?.length) throw new ApiFail(502, GH_CODE, `GitHub GraphQL: ${b.errors[0]!.message}`);
  return b.data ?? {};
}

async function form(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(GH_WEB + path, {
    method: "POST",
    headers: { Accept: JSON_TYPE, "Content-Type": JSON_TYPE, "User-Agent": GITHUB_USER_AGENT },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new ApiFail(502, GH_CODE, `GitHub ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export type DeviceStart = { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
export type TokenGrant = { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; error?: string; interval?: number };

// 设备码流程: OAuth App 要 scope, GitHub App 忽略 scope 只看安装时选的权限
export function deviceStart(clientId: string): Promise<DeviceStart> {
  return form("/login/device/code", { client_id: clientId, scope: "repo" }) as Promise<DeviceStart>;
}

export function devicePoll(clientId: string, deviceCode: string): Promise<TokenGrant> {
  return form("/login/oauth/access_token", { client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }) as Promise<TokenGrant>;
}

// 过期令牌续期: 设备码流程拿到的令牌不需要 client_secret, 配了就带上 (网页流程 / GitHub App 要)
export function refreshGrant(clientId: string, secret: string | undefined, refresh: string): Promise<TokenGrant> {
  return form("/login/oauth/access_token", { client_id: clientId, ...(secret ? { client_secret: secret } : {}), grant_type: "refresh_token", refresh_token: refresh }) as Promise<TokenGrant>;
}
