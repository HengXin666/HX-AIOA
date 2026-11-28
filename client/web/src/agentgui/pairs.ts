import { api } from "../core/auth";
import { Emitter } from "../core/emitter";
import { PATH_AGENT_GUI_PAIR } from "@hx-aioa/protocol";
import { ROUTE_ORDER, STORAGE_AG_PAIRS } from "./constants";
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
