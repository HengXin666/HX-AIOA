// Web Push (W3, #155): 浏览器订阅的上报格式与校验, 服务端和 Web 端共用
export const WEB_DEVICE_PREFIX = "web-";
export const WEBPUSH_ENDPOINT_MAX = 1024;
export const WEB_DEVICE_MAX = 64;
// p256dh 是 65 字节未压缩点 (base64url 87 字符), auth 是 16 字节 (22 字符); 上限留一点余量
const P256DH_LEN = 87;
const AUTH_LEN = 22;
const B64URL = /^[A-Za-z0-9_-]+$/;
const DEVICE_RE = /^web-[A-Za-z0-9_-]+$/;

/** 浏览器 `PushSubscription.toJSON()` 的形状 (expirationTime 可有可无, 服务端不存)。 */
export type WebPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: number | null };

/** `GET /api/v1/webpush/key`: 服务端没配 VAPID 时 key 为 null。 */
export type WebPushKey = { key: string | null };

/** SW 收到的明文: 只放通知要用的字段。 */
export type WebPushPayload = { title: string; body: string; channel?: string; seq: number; tag: string };

export const isWebDevice = (id: string): boolean => id.length <= WEB_DEVICE_MAX && DEVICE_RE.test(id);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 校验订阅: endpoint 必须 https 且不超长, 两把 key 必须是 base64url 且长度对。返回错误文字或订阅。 */
export function parseWebPushSub(raw: unknown): WebPushSubscription | string {
  if (!isObj(raw) || typeof raw.endpoint !== "string" || !isObj(raw.keys)) return "需要 PushSubscription.toJSON() 的 { endpoint, keys: { p256dh, auth } }";
  const endpoint = raw.endpoint;
  if (endpoint.length > WEBPUSH_ENDPOINT_MAX) return `endpoint 超过 ${WEBPUSH_ENDPOINT_MAX} 字符`;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "endpoint 不是合法地址";
  }
  if (url.protocol !== "https:") return "endpoint 必须是 https";
  const { p256dh, auth } = raw.keys;
  if (typeof p256dh !== "string" || p256dh.length !== P256DH_LEN || !B64URL.test(p256dh)) return "keys.p256dh 必须是 base64url 的 P-256 公钥";
  if (typeof auth !== "string" || auth.length !== AUTH_LEN || !B64URL.test(auth)) return "keys.auth 必须是 base64url 的 16 字节密钥";
  return { endpoint, keys: { p256dh, auth } };
}
