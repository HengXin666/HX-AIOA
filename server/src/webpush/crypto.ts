// Web Push 的加密 (RFC 8291 + RFC 8188 aes128gcm) 与 VAPID 签名 (RFC 8292), 只用 WebCrypto
const enc = new TextEncoder();
const RECORD_SIZE = 4096;
const SALT_LEN = 16;
const KEY_LEN = 16;
const NONCE_LEN = 12;
const POINT_LEN = 65;
const COORD_LEN = 32;
const PAD_DELIMITER = 0x02;
const CURVE = "P-256";
const HASH = "SHA-256";
// VAPID JWT 有效 12 小时, 剩不到 1 小时就换新的
export const VAPID_TTL_SEC = 12 * 3600;
const VAPID_RENEW_SEC = 3600;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 未压缩公钥点 (65 字节) + 私钥 d 拼成 JWK; 公钥格式不对时抛错。 */
export function pointJwk(publicKey: Uint8Array, d?: string): JsonWebKey {
  if (publicKey.length !== POINT_LEN || publicKey[0] !== 0x04) throw new Error("公钥必须是 65 字节未压缩 P-256 点");
  const jwk: JsonWebKey = { kty: "EC", crv: CURVE, x: b64url(publicKey.slice(1, 1 + COORD_LEN)), y: b64url(publicKey.slice(1 + COORD_LEN)), ext: true };
  if (d) jwk.d = d;
  return jwk;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: HASH, salt, info }, key, bytes * 8));
}

/** 测试注入固定的服务端临时密钥与 salt; 平时每条消息随机生成。 */
export type EncryptFixture = { asPrivate: string; asPublic: string; salt: string };

/** RFC 8291: 用订阅的 p256dh / auth 加密一条消息, 输出 aes128gcm 单记录 (含头)。 */
export async function encryptPayload(plain: Uint8Array, p256dh: string, auth: string, fixture?: EncryptFixture): Promise<Uint8Array> {
  const uaPublic = unb64url(p256dh);
  const ecdh = { name: "ECDH", namedCurve: CURVE };
  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (fixture) {
    asPublic = unb64url(fixture.asPublic);
    asPrivate = await crypto.subtle.importKey("jwk", pointJwk(asPublic, fixture.asPrivate), ecdh, false, ["deriveBits"]);
  } else {
    const pair = (await crypto.subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, ecdh, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPrivate, 256));
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(unb64url(auth), secret, keyInfo, 32);
  const salt = fixture ? unb64url(fixture.salt) : crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), KEY_LEN);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), NONCE_LEN);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plain, new Uint8Array([PAD_DELIMITER]))));
  const header = new Uint8Array(SALT_LEN + 5);
  header.set(salt);
  new DataView(header.buffer).setUint32(SALT_LEN, RECORD_SIZE);
  header[SALT_LEN + 4] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** VAPID 私钥: base64url 的 d, 或整个 JWK (JSON)。 */
export async function vapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const raw = privateKey.trim();
  const jwk: JsonWebKey = raw.startsWith("{") ? { ...(JSON.parse(raw) as JsonWebKey), ext: true } : pointJwk(unb64url(publicKey), raw);
  delete jwk.key_ops;
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: CURVE }, false, ["sign"]);
}

/** ES256 JWT, 按推送服务的源缓存到快过期。 */
export class VapidSigner {
  private readonly cache = new Map<string, { jwt: string; exp: number }>();
  private key: Promise<CryptoKey> | null = null;

  constructor(
    private readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {}

  async header(endpoint: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
    const aud = new URL(endpoint).origin;
    const hit = this.cache.get(aud);
    if (hit && hit.exp - nowSec > VAPID_RENEW_SEC) return `vapid t=${hit.jwt}, k=${this.publicKey}`;
    const exp = nowSec + VAPID_TTL_SEC;
    const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const body = b64url(enc.encode(JSON.stringify({ aud, exp, sub: this.subject })));
    this.key ??= vapidKey(this.publicKey, this.privateKey);
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: HASH }, await this.key, enc.encode(`${head}.${body}`));
    const jwt = `${head}.${body}.${b64url(new Uint8Array(sig))}`;
    this.cache.set(aud, { jwt, exp });
    return `vapid t=${jwt}, k=${this.publicKey}`;
  }
}
