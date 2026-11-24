// CF 统计的缓存: 内存一层 (同一 isolate 内最快) + Cache API 一层 (isolate 回收后还在, 不占 DO 写入额度)。
// 冷启动时直接拿边缘缓存, 不用再串行跑 REST + 多次 GQL。

const CACHE_HOST = "https://cf-cache.aioa.internal/";
const HEADER_AT = "x-aioa-at";

type Entry<T> = { at: number; body: T };
const mem = new Map<string, Entry<unknown>>();

function edge(): Cache | null {
  // 单元测试 (node) 里没有 caches
  return typeof caches === "undefined" ? null : (caches as unknown as { default: Cache }).default;
}

/** 取 key 的缓存, ttlMs 内有效; 没有或过期就调 load 并写回两层。 */
export async function cfCached<T>(key: string, ttlMs: number, now: number, load: () => Promise<T>): Promise<T> {
  const hit = mem.get(key) as Entry<T> | undefined;
  if (hit && now - hit.at < ttlMs) return hit.body;
  const c = edge();
  const url = CACHE_HOST + encodeURIComponent(key);
  if (c) {
    const res = await c.match(url).catch(() => undefined);
    const at = Number(res?.headers.get(HEADER_AT) ?? 0);
    if (res && now - at < ttlMs) {
      const body = (await res.json()) as T;
      mem.set(key, { at, body });
      return body;
    }
  }
  const body = await load();
  mem.set(key, { at: now, body });
  if (c) {
    const res = new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "cache-control": `max-age=${Math.ceil(ttlMs / 1000)}`, [HEADER_AT]: String(now) },
    });
    await c.put(url, res).catch(() => undefined);
  }
  return body;
}
