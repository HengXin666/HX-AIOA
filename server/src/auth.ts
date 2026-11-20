import { QUERY_TOKEN } from "@hx-aioa/protocol";
import { BEARER_PREFIX, HEADER_AUTH } from "./constants";

const encoder = new TextEncoder();

function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

// 浏览器的 WebSocket 无法自定义请求头, 所以同时接受 query 中的 token
export function isAuthorized(req: Request, url: URL, expected: string): boolean {
  if (!expected) return false;
  const header = req.headers.get(HEADER_AUTH) ?? "";
  if (header.startsWith(BEARER_PREFIX)) {
    return safeEqual(header.slice(BEARER_PREFIX.length), expected);
  }
  const token = url.searchParams.get(QUERY_TOKEN);
  return token !== null && safeEqual(token, expected);
}
