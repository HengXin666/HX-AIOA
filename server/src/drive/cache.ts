import { sha256 } from "../auth";
import type { DriveFs } from "./client";

// 网盘列表的边缘缓存 (#159): Cache API, 不占 D1 / DO 写入额度。键里带网盘版本号, 写操作把版本号换新, 旧键全部作废
const HOST = "https://drive-cache.aioa.internal/";
const GEN = "gen";
/** 列表缓存多久: 自己的写操作靠版本号即时失效, 这个只兜底主人在 Drive 后台直接改的情况 (下拉刷新绕过缓存)。 */
export const DRIVE_CACHE_TTL_SEC = 300;
// 版本号要比列表活得久, 否则被淘汰后可能读回旧版本对应的旧键
const GEN_TTL_SEC = 86400;
// 同一 isolate 内记住见过的最大版本号, 边缘里的版本号被淘汰时不倒退
const gens = new Map<string, number>();

function edge(): Cache | null {
  return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null;
}

/** 一个网盘 (Drive 地址 + 令牌) 在一个主人视角下的缓存; 每次请求新建, 版本号每次请求最多读 1 次。 */
export class DriveCache {
  private gen: number | null = null;

  private constructor(
    private readonly drive: string,
    private readonly owner: string,
  ) {}

  static async of(fs: DriveFs, owner: string): Promise<DriveCache> {
    return new DriveCache((await sha256(fs.cacheId)).slice(0, 16), owner);
  }

  private get genUrl(): string {
    return `${HOST}${GEN}/${this.drive}`;
  }

  private async version(): Promise<number> {
    if (this.gen !== null) return this.gen;
    const res = await edge()?.match(this.genUrl).catch(() => undefined);
    const v = Number((await res?.text().catch(() => "")) || 0);
    this.gen = Math.max(Number.isFinite(v) ? v : 0, gens.get(this.drive) ?? 0);
    return this.gen;
  }

  private async url(kind: string, key: string): Promise<string> {
    return `${HOST}${kind}/${this.drive}/${encodeURIComponent(this.owner)}/${await this.version()}?k=${encodeURIComponent(key)}`;
  }

  async get<T>(kind: string, key: string): Promise<T | null> {
    const c = edge();
    if (!c) return null;
    const res = await c.match(await this.url(kind, key)).catch(() => undefined);
    return res ? ((await res.json().catch(() => null)) as T | null) : null;
  }

  async put(kind: string, key: string, body: unknown): Promise<void> {
    const c = edge();
    if (!c) return;
    const res = new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": `max-age=${DRIVE_CACHE_TTL_SEC}` } });
    await c.put(await this.url(kind, key), res).catch(() => undefined);
  }

  /** 网盘内容变了: 换一个更大的版本号, 这个网盘所有主人视角的旧键一起作废。 */
  async bump(now = Date.now()): Promise<void> {
    const v = Math.max(now, (gens.get(this.drive) ?? 0) + 1, (this.gen ?? 0) + 1);
    gens.set(this.drive, v);
    this.gen = v;
    await edge()?.put(this.genUrl, new Response(String(v), { headers: { "cache-control": `max-age=${GEN_TTL_SEC}` } })).catch(() => undefined);
  }

  /** 主 Hub 里的写操作 (存到网盘, 迁移) 用: 只换版本号。 */
  static async bumpFor(fs: DriveFs): Promise<void> {
    await (await DriveCache.of(fs, "")).bump();
  }
}
