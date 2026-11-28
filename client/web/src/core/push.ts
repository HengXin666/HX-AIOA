import { PATH_DEVICE_WEBPUSH, PATH_WEBPUSH_KEY, type WebPushKey } from "@hx-aioa/protocol";
import { api, deviceId, fill } from "./auth";

// 浏览器原生推送 (W3): SW 只处理通知, 订阅存服务端, 页面没开时由兜底推送发过来
export type PushState = "unsupported" | "denied" | "off" | "on" | "unconfigured";

const SW_URL = "/sw.js";
const GRANTED = "granted";
const ERR_UNSUPPORTED = "当前浏览器不支持推送通知";
const ERR_DENIED = "通知权限被拒绝, 请在浏览器的站点设置里允许通知";
const ERR_UNCONFIGURED = "服务端没有配置 Web Push";

let registering: Promise<ServiceWorkerRegistration | null> | null = null;
// 公钥只在内存缓存, 一次页面会话最多问一次
let keyCache: Promise<string | null> | null = null;

export function pushSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** 注册 SW (只管通知, 不缓存不拦截请求); 不支持或失败时返回 null。 */
export function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return Promise.resolve(null);
  registering ??= navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch((e: unknown) => {
    console.warn("注册 Service Worker 失败:", e);
    registering = null;
    return null;
  });
  return registering;
}

function serverKey(): Promise<string | null> {
  keyCache ??= api<WebPushKey>(PATH_WEBPUSH_KEY)
    .then((r) => r?.key ?? null)
    .catch((e: unknown) => {
      keyCache = null;
      throw e;
    });
  return keyCache;
}

function unb64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const cur = sub.options.applicationServerKey;
  if (!cur) return false;
  const a = new Uint8Array(cur);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** 本机推送状态: 已订阅时不发请求; 未订阅才问服务端有没有配置。 */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === GRANTED && (await currentSub())) return "on";
  return (await serverKey().catch(() => null)) ? "off" : "unconfigured";
}

/** 打开推送: 必须在用户点击里调用 (先申请权限, 再取公钥, 订阅, 上报服务端)。 */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error(ERR_UNSUPPORTED);
  if ((await Notification.requestPermission()) !== GRANTED) throw new Error(ERR_DENIED);
  const key = await serverKey();
  if (!key) throw new Error(ERR_UNCONFIGURED);
  const reg = await registerSW();
  if (!reg) throw new Error(ERR_UNSUPPORTED);
  await navigator.serviceWorker.ready;
  const raw = unb64url(key);
  let sub = await reg.pushManager.getSubscription();
  // 服务端换了 VAPID 密钥: 旧订阅作废, 重新订阅
  if (sub && !sameKey(sub, raw)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
  await api(fill(PATH_DEVICE_WEBPUSH, deviceId()), { method: "PUT", body: JSON.stringify(sub.toJSON()) });
}

/** 已订阅时把订阅再报一次 (服务端没变不写库); 浏览器可能自己换了订阅, 页面登录后调一次即可。 */
export async function syncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== GRANTED) return;
  const sub = await currentSub();
  if (sub) await api(fill(PATH_DEVICE_WEBPUSH, deviceId()), { method: "PUT", body: JSON.stringify(sub.toJSON()) });
}

/** 关闭推送: 本机退订, 并删掉服务端这台设备的订阅。 */
export async function disablePush(): Promise<void> {
  if (pushSupported()) await (await currentSub())?.unsubscribe();
  await api(fill(PATH_DEVICE_WEBPUSH, deviceId()), { method: "DELETE" });
}
