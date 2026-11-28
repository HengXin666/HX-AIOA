import { api } from "../core/auth";
import { Emitter } from "../core/emitter";
import { PATH_AGENT_GUI_PAIR } from "@hx-aioa/protocol";
import { ROUTE_ORDER, STORAGE_AG_PAIRS, TXT_ROUTE_LOCAL_OFF, TXT_ROUTE_MIXED } from "./constants";
import { deviceKey } from "./keys";
import type { PairResult, Route } from "./types";

// 配对记录: 主机公钥 (之后每次连接都核对) 与路线, 上次成功的路线排第一
export type Pair = { host: string; pub: JsonWebKey; routes: Route[]; last?: string; at: number };

export const pairsChanged = new Emitter<void>();
let pairs: Record<string, Pair> = load();
let version = 0;

function load(): Record<string, Pair> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_AG_PAIRS) ?? "{}") as Record<string, Pair>;
  } catch {
    return {};
  }
}

function save(): void {
  localStorage.setItem(STORAGE_AG_PAIRS, JSON.stringify(pairs));
  version++;
  pairsChanged.emit();
}

window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_AG_PAIRS) return;
  pairs = load();
  version++;
  pairsChanged.emit();
});

export const pairsVersion = (): number => version;
export const getPair = (host: string): Pair | undefined => pairs[host];
export const allPairs = (): Pair[] => Object.values(pairs).sort((a, b) => a.host.localeCompare(b.host));

export function putPair(p: Pair): void {
  pairs = { ...pairs, [p.host]: p };
  save();
}

export function removePair(host: string): void {
  const next = { ...pairs };
  delete next[host];
  pairs = next;
  save();
}

export function rememberRoute(host: string, url: string): void {
  const p = pairs[host];
  if (!p || p.last === url) return;
  putPair({ ...p, last: url });
}

// Hub 报来的新路线 (隧道地址会变); 公钥不从这里改
export function updateRoutes(host: string, routes: Route[]): void {
  const p = pairs[host];
  if (!p || JSON.stringify(p.routes) === JSON.stringify(routes)) return;
  putPair({ ...p, routes });
}

// 试连顺序: 上次成功 -> local -> lan -> tunnel
export function routeOrder(p: Pair): Route[] {
  const rank = (r: Route) => (r.url === p.last ? -1 : ROUTE_ORDER.indexOf(r.kind));
  return [...p.routes].sort((a, b) => rank(a) - rank(b));
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i;
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};
export const isLoopback = (url: string): boolean => LOOPBACK.test(hostOf(url));
// 页面就是在本机打开的 (localhost / 127.0.0.1)
const localPage = (): boolean => LOOPBACK.test(location.hostname);
// 手机 / 平板不可能是跑探针的那台电脑 (iPadOS 报 Macintosh, 靠触点数认)
export function isDesktop(): boolean {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
  return !(/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** 这条路线在这台设备 / 这个页面上能不能试: 返回不能的原因, 能试返回 ""。 */
export function routeBlock(r: Route): string {
  const loop = r.kind === "local" || isLoopback(r.url);
  // 本机地址: 只有在这台主机本机 (桌面浏览器, 或页面本身就是本机打开) 才有意义
  if (loop) return localPage() || isDesktop() ? "" : TXT_ROUTE_LOCAL_OFF;
  // https 页面连不了 http / ws:// 的非本机地址 (混合内容), 直接标不可用, 不去连
  if (location.protocol === "https:" && /^http:/i.test(r.url)) return TXT_ROUTE_MIXED;
  return "";
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "浏览器";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Mac/i.test(ua) ? "macOS" : /Windows/i.test(ua) ? "Windows" : "Linux";
  return `${browser} · ${os} (Web)`;
}

// 经 Hub 配对一次: 密码复用终端票据的错锁
export async function pairHost(subject: string, password: string): Promise<Pair> {
  const k = await deviceKey();
  const r = await api<PairResult>(PATH_AGENT_GUI_PAIR, { method: "POST", body: JSON.stringify({ subject, password, device: { id: k.id, name: deviceName(), pub: k.pub } }) });
  const p: Pair = { host: r.host || subject, pub: r.pub, routes: r.routes ?? [], at: Date.now() };
  putPair(p);
  return p;
}
