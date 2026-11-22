import { QUERY_KEY, QUERY_TOKEN } from "@hx-aioa/protocol";
import { BEARER_PREFIX, HEADER_AUTH } from "./constants";

const encoder = new TextEncoder();

export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

// 浏览器的 WebSocket 无法自定义请求头, 所以同时接受 query 中的 token / key
export function credentialOf(req: Request, url: URL): string {
  const header = req.headers.get(HEADER_AUTH) ?? "";
  if (header.startsWith(BEARER_PREFIX)) return header.slice(BEARER_PREFIX.length);
  return url.searchParams.get(QUERY_TOKEN) ?? url.searchParams.get(QUERY_KEY) ?? "";
}

export function isOwnerToken(cred: string, expected: string): boolean {
  return Boolean(expected) && Boolean(cred) && safeEqual(cred, expected);
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

export async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

export function randomId(prefix: string, bytes = 8): string {
  return prefix + hex(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

export function randomSecret(prefix: string): string {
  const raw = crypto.getRandomValues(new Uint8Array(24));
  return prefix + btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
