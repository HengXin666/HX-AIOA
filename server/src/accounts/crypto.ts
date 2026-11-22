import { hmac, safeEqual } from "../auth";
import { PBKDF2_ITERATIONS } from "./constants";

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 256));
}

// 存储格式: pbkdf2$<迭代次数>$<salt>$<hash>, 以后调高迭代次数不影响旧密码
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split("$");
  if (algo !== "pbkdf2" || !iter || !salt || !hash) return false;
  return safeEqual(await pbkdf2(password, fromB64url(salt), Number(iter)), hash);
}

export type AccessClaims = { u: string; s: string; e: number };

// 访问令牌无状态签名, 校验时仍会查会话表, 所以踢下线立即生效
export async function signAccess(secret: string, prefix: string, claims: AccessClaims): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(claims)));
  return `${prefix}${body}.${await hmac(secret, `access:${body}`)}`;
}

export async function verifyAccess(secret: string, prefix: string, token: string, now: number): Promise<AccessClaims | null> {
  if (!token.startsWith(prefix)) return null;
  const [body, sig] = token.slice(prefix.length).split(".");
  if (!body || !sig || !safeEqual(sig, await hmac(secret, `access:${body}`))) return null;
  try {
    const c = JSON.parse(new TextDecoder().decode(fromB64url(body))) as AccessClaims;
    if (typeof c.u !== "string" || typeof c.s !== "string" || typeof c.e !== "number" || c.e <= now) return null;
    return c;
  } catch {
    return null;
  }
}
