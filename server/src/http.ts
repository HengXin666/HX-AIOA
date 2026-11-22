import { CODE_BAD_REQUEST, CONTENT_TYPE_JSON, ERR_BAD_JSON, HEADER_CONTENT_TYPE } from "./constants";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Event, X-Hub-Signature-256",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON, ...CORS_HEADERS },
  });
}

export function fail(status: number, text: string, code = CODE_BAD_REQUEST, extra: Record<string, unknown> = {}): Response {
  return json({ error: text, code, ...extra }, status);
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function clampInt(raw: string | null, fallback: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => undefined);
}

export const badJson = () => fail(400, ERR_BAD_JSON);

// 业务层抛出的可预期错误, 由路由统一转成 HTTP 响应或 err 帧
export class ApiFail extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    text: string,
  ) {
    super(text);
  }
}
