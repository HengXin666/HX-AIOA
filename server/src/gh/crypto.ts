// 令牌落库前用 AES-GCM 加密, 密钥由服务端 secret 派生, 数据库泄露也拿不到明文
const enc = new TextEncoder();
const IV_BYTES = 12;

async function keyOf(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`gh-token:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(secret: string, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyOf(secret), enc.encode(text)));
  return `${b64(iv)}.${b64(data)}`;
}

export async function unseal(secret: string, sealed: string): Promise<string> {
  const [iv, data] = sealed.split(".");
  const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv ?? "") }, await keyOf(secret), unb64(data ?? ""));
  return new TextDecoder().decode(out);
}
