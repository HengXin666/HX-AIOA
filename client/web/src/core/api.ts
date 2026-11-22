import { AUTH_TOKEN, SERVER_URL } from "../constants";

export const hasServer = () => Boolean(SERVER_URL);

// 统一的 HTTP 调用, 失败抛出带中文说明的错误
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!SERVER_URL) throw new Error("未配置服务端地址");
  const res = await fetch(new URL(path, SERVER_URL), {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_TOKEN}`, ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `请求失败 (${res.status})`);
  return body;
}

export const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });
