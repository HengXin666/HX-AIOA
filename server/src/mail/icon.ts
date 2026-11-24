import { siteOf } from "@hx-aioa/protocol";
import { fail } from "../http";
import { CODE_NOT_FOUND } from "../constants";

// 发件方网站图标: 按主域名向 Google 图标服务取, 结果放 Cache API (有图 7 天, 没图 1 天)
const SOURCE = (d: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`;
const CACHE_KEY = (d: string) => `https://mail-icon.aioa.internal/${d}`;
const HIT_TTL_S = 7 * 86_400;
const MISS_TTL_S = 86_400;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const MAX_DOMAIN = 100;
const MAX_BYTES = 64 * 1024;
const MISS_HEADER = "x-icon-miss";
const ERR_NONE = "没有图标";

const cache = () => (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;

export async function mailIcon(raw: string): Promise<Response> {
  const d = siteOf(raw.toLowerCase());
  if (!DOMAIN_RE.test(d) || d.length > MAX_DOMAIN) return fail(400, "域名无效");
  const key = new Request(CACHE_KEY(d));
  const c = cache();
  let res = await c?.match(key);
  if (!res) {
    res = await load(d);
    await c?.put(key, res.clone()).catch(() => undefined);
  }
  if (res.headers.get(MISS_HEADER)) return fail(404, ERR_NONE, CODE_NOT_FOUND);
  return new Response(res.body, { headers: { "content-type": res.headers.get("content-type") ?? "image/png", "cache-control": `private, max-age=${HIT_TTL_S}` } });
}

// Google 找不到时回 404 加默认地球图标, 当作没有
async function load(d: string): Promise<Response> {
  const miss = new Response(null, { headers: { [MISS_HEADER]: "1", "cache-control": `max-age=${MISS_TTL_S}` } });
  const r = await fetch(SOURCE(d)).catch(() => null);
  if (!r?.ok) return miss;
  const buf = await r.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_BYTES) return miss;
  return new Response(buf, { headers: { "content-type": r.headers.get("content-type") ?? "image/png", "cache-control": `max-age=${HIT_TTL_S}` } });
}
