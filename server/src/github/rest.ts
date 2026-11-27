import { GITHUB_API, GITHUB_USER_AGENT } from "../constants";

// remaining: 本小时剩余的 REST 额度, 响应没带时当作不限
export type RestRes = { status: number; ok: boolean; body: unknown; remaining: number };

const NO_LIMIT = Number.POSITIVE_INFINITY;

export const ghHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": GITHUB_USER_AGENT,
  "X-GitHub-Api-Version": "2022-11-28",
});

/** GET GitHub REST, 非 2xx 不抛, 由调用方按状态码处理。 */
export async function restGet(token: string, path: string): Promise<RestRes> {
  const res = await fetch(GITHUB_API + path, { headers: ghHeaders(token) });
  const left = Number(res.headers.get("x-ratelimit-remaining") ?? Number.NaN);
  const body = res.ok ? await res.json() : await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, body, remaining: Number.isFinite(left) ? left : NO_LIMIT };
}

/** 毫秒 → GitHub 接受的 ISO 时间 (秒精度)。 */
export const isoSec = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
