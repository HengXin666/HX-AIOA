import { PATH_AUTH_LOGIN, PATH_AUTH_LOGOUT, PATH_AUTH_REFRESH, PATH_JOIN, PATH_SETUP, type JoinResult, type TokenPair, type UserPublic } from "@hx-aioa/protocol";
import { clearCache } from "./cache";
import { DEVICE_PREFIX, LOCK_REFRESH, PLATFORM_WEB, REFRESH_EARLY_MS, STORAGE_DEVICE, STORAGE_REFRESH, TXT_NETWORK } from "./constants";
import { Emitter } from "./emitter";

// 访问令牌只放内存; 刷新令牌放 localStorage, 关页再开用它换新 (60 天未用失效)
type Session = { access: string; expires: number; user: UserPublic };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const authChanged = new Emitter<UserPublic | null>();
let session: Session | null = null;
let refreshing: Promise<boolean> | null = null;

export function deviceId(): string {
  let id = localStorage.getItem(STORAGE_DEVICE);
  if (!id) {
    id = DEVICE_PREFIX + crypto.randomUUID().slice(0, 8);
    localStorage.setItem(STORAGE_DEVICE, id);
  }
  return id;
}

export const currentUser = (): UserPublic | null => session?.user ?? null;
// 改了昵称 / 头像后更新本地会话里的自己
export function setCurrentUser(user: UserPublic): void {
  if (!session) return;
  session = { ...session, user };
  authChanged.emit(user);
}
// 还新鲜的访问令牌 (不触发刷新), 给共享连接握手用
export const currentToken = (): { value: string; exp: number } | null =>
  session && session.expires - Date.now() > REFRESH_EARLY_MS ? { value: session.access, exp: session.expires } : null;
export const hasRefresh = (): boolean => Boolean(localStorage.getItem(STORAGE_REFRESH));

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Mac/i.test(ua) ? "macOS" : /Windows/i.test(ua) ? "Windows" : "Linux";
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "浏览器";
  return `${browser} · ${os}`;
}

function accept(pair: TokenPair): UserPublic {
  localStorage.setItem(STORAGE_REFRESH, pair.refresh);
  session = { access: pair.access, expires: Date.now() + pair.expiresIn * 1000, user: pair.user };
  authChanged.emit(pair.user);
  return pair.user;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, TXT_NETWORK);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `请求失败 (${res.status})`, data.code);
  return data;
}

export async function setupDone(): Promise<boolean> {
  const res = await fetch(PATH_SETUP).catch(() => null);
  if (!res?.ok) return true;
  const body = (await res.json().catch(() => ({ done: true }))) as { done?: boolean };
  return body.done !== false;
}

export async function login(name: string, password: string): Promise<UserPublic> {
  const pair = await post<TokenPair>(PATH_AUTH_LOGIN, { name, password, device: { name: deviceName(), platform: PLATFORM_WEB } });
  return accept(pair);
}

// 用邀请码注册; 需要主人批准时返回 pending, 不登录
export async function join(code: string, name: string, password: string, display?: string): Promise<"ok" | "pending"> {
  const r = await post<JoinResult>(PATH_JOIN, { code, name, password, display, device: { name: deviceName(), platform: PLATFORM_WEB } });
  if ("pending" in r) return "pending";
  accept(r);
  return "ok";
}

// 跨标签串行: 刷新令牌每次都会换新, 别的标签刚换过时这里读到的已是新值
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  return navigator.locks ? (navigator.locks.request(LOCK_REFRESH, fn) as unknown as Promise<T>) : fn();
}

// 并发调用共用同一次刷新, 刷新令牌每次都会换新, 不能各刷各的
export function refresh(): Promise<boolean> {
  refreshing ??= exclusive(async () => {
    const token = localStorage.getItem(STORAGE_REFRESH);
    if (!token) return false;
    try {
      accept(await post<TokenPair>(PATH_AUTH_REFRESH, { refresh: token }));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOutLocal();
      return false;
    }
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function accessToken(): Promise<string | null> {
  if (session && session.expires - Date.now() > REFRESH_EARLY_MS) return session.access;
  return (await refresh()) ? (session?.access ?? null) : null;
}

export function signOutLocal(): void {
  localStorage.removeItem(STORAGE_REFRESH);
  void clearCache();
  if (!session) return;
  session = null;
  authChanged.emit(null);
}

// 别的标签退出登录: 这里也回登录页
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_REFRESH && e.newValue === null && session) signOutLocal();
});

export async function logout(): Promise<void> {
  await api(PATH_AUTH_LOGOUT, { method: "POST" }).catch(() => undefined);
  signOutLocal();
}

export type ApiResult<T> = { status: number; data: T | null; etag: string | null };

// 带凭证的请求; 401 时换一次令牌重试, 仍然 401 就回登录页
export async function apiRaw<T>(path: string, init: RequestInit = {}, retried = false): Promise<ApiResult<T>> {
  const token = await accessToken();
  if (!token) throw new ApiError(401, "登录已失效");
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init.headers, authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError(0, TXT_NETWORK);
  }
  if (res.status === 401 && !retried) {
    if (session) session.expires = 0;
    return apiRaw(path, init, true);
  }
  if (res.status === 401) signOutLocal();
  if (res.status === 304) return { status: 304, data: null, etag: res.headers.get("etag") };
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `请求失败 (${res.status})`, body.code);
  return { status: res.status, data: body, etag: res.headers.get("etag") };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await apiRaw<T>(path, init);
  return r.data as T;
}

export const fill = (path: string, ...args: string[]): string => {
  let i = 0;
  return path.replace(/\{[^}]+\}/g, () => encodeURIComponent(args[i++] ?? ""));
};
