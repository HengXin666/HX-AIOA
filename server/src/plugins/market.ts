import {
  MAX_INDEX_TEXT,
  MAX_PLUGIN_TEXT,
  MAX_SOURCES,
  OFFICIAL_SOURCE,
  PLUGIN_INDEX_FILE,
  PLUGIN_MANIFEST_FILE,
  isL2a,
  isNsPluginId,
  officialOnly,
  parseManifest,
  parseMarketLink,
  resolvePluginId,
  type MarketSource,
  type PluginEntry,
  type PluginIndex,
  type PluginManifest,
} from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_CONFLICT, CODE_NOT_FOUND } from "../constants";
import { ApiFail } from "../http";
import { IDX, MarketStore } from "./market-store";

// 官方市场就是仓库里的 plugins/ 目录, 公开只读
const DEFAULT_MARKET = "https://raw.githubusercontent.com/HengXin666/HX-AIOA/main/plugins";
// 索引每源 30 分钟最多拉一次 (落库, 休眠重启不重拉); 文件按版本缓存, 版本不变不再拉
const INDEX_TTL = 30 * 60_000;
// "最新" (管理员看详情, 放行) 10 秒内拉过的索引就算最新, 只重拉目标插件所在的源
const FRESH_REUSE = 10_000;
// 源连不上时隔 5 分钟再试, 期间用旧索引
const ERROR_TTL = 5 * 60_000;
const UA = "hx-aioa-server/1";
const CODE_MARKET = "market_unavailable";

type Entry = PluginEntry & { manifest?: unknown };
type Loaded = { at: number; entries: Entry[]; error?: string; retry?: number };
type Located = { src: MarketSource; entry: Entry };
// force 只在内部用: 不复用, 一定重拉
export type FetchMode = "cache" | "latest" | "fresh" | "force";

/** 读响应体, 超过上限就停, 不把整个大响应读进内存。 */
async function readCapped(res: Response, max: number, name: string): Promise<string> {
  const tooBig = () => new ApiFail(502, CODE_MARKET, `${name} 超过 ${max} 字`);
  if (Number(res.headers.get("content-length") ?? 0) > max * 4) throw tooBig();
  const reader = res.body?.getReader();
  if (!reader) return "";
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    if (text.length > max) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
  }
  return text + dec.decode();
}

async function fetchText(url: string, max: number): Promise<string> {
  const name = url.split("/").slice(-2).join("/");
  const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
  if (!res) throw new ApiFail(502, CODE_MARKET, "插件市场暂时连不上");
  // 跟随跳转后必须还是 https (本机开发源除外, 它本来就是 http)
  if (res.url && !res.url.startsWith("https://") && new URL(res.url).origin !== new URL(url).origin) throw new ApiFail(502, CODE_MARKET, `${name} 跳转到了非 https 地址`);
  if (res.status === 404) throw new ApiFail(404, CODE_NOT_FOUND, `市场里没有 ${name}`);
  if (!res.ok) throw new ApiFail(502, CODE_MARKET, `插件市场返回 HTTP ${res.status}`);
  return readCapped(res, max, name);
}

function parseIndex(text: string): { name?: string; entries: Entry[] } {
  const raw = JSON.parse(text) as Partial<PluginIndex>;
  const entries = Array.isArray(raw.plugins) ? raw.plugins.filter((p): p is Entry => !!p && typeof p.id === "string" && typeof p.version === "string") : [];
  return { ...(typeof raw.name === "string" ? { name: raw.name } : {}), entries };
}

/** 第三方源只收带命名空间的新 id: 不能是官方命名空间, 旧 id 别名, 服务端插件。 */
function thirdPartyBad(id: string): string | null {
  if (officialOnly(id)) return "官方命名空间";
  if (!isNsPluginId(id) || resolvePluginId(id) !== id || isL2a(id)) return "id 要写成 <作者>.<名字>";
  return null;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 多源市场: 只在有人打开市场, 看详情或放行时拉, 结果落库按版本复用。 */
export class Market {
  private readonly store: MarketStore;
  private readonly loaded = new Map<string, Loaded>();
  private readonly skipped = new Map<string, string[]>();
  private readonly counts = new Map<string, number>();
  // 同一个源同时只拉一次: DO 在 await 期间会交错处理别的请求
  private readonly inflight = new Map<string, Promise<Loaded>>();

  constructor(
    private readonly base: string | undefined,
    sql: SqlStorage,
  ) {
    this.store = new MarketStore(sql);
  }

  private official(): MarketSource {
    const url = (this.base || DEFAULT_MARKET).replace(/\/+$/, "");
    return { id: OFFICIAL_SOURCE, name: "官方", url, link: url, official: true, added: 0 };
  }

  /** 官方源在前, 其余按添加顺序; 带最近一次拉取的状态。 */
  sources(): MarketSource[] {
    return [this.official(), ...this.store.sources()].map((s) => {
      const l = this.loaded.get(s.id);
      const skipped = this.skipped.get(s.id);
      const count = this.counts.get(s.id) ?? l?.entries.length;
      return { ...s, ...(l ? { at: l.at, count } : {}), ...(l?.error ? { error: l.error } : {}), ...(skipped?.length ? { skipped } : {}) };
    });
  }

  errors(): string[] {
    return this.sources().filter((s) => s.error).map((s) => `${s.name}: ${s.error}`);
  }

  /** 加一个源: 依次试候选目录的 index.json (最多两次请求), 第一个能解析的就是。 */
  async addSource(link: string): Promise<MarketSource> {
    // 本机 http 只在官方源本身指向本机时放行 (本地开发与 e2e)
    const p = parseMarketLink(link, /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(this.official().url));
    if (typeof p === "string") throw new ApiFail(400, CODE_BAD_REQUEST, p);
    const third = this.store.sources();
    if (third.length >= MAX_SOURCES) throw new ApiFail(400, CODE_BAD_REQUEST, `第三方源最多 ${MAX_SOURCES} 个`);
    if (p.id === OFFICIAL_SOURCE || third.some((s) => s.id === p.id)) throw new ApiFail(409, CODE_CONFLICT, "这个源已经加过了");
    let last = "";
    for (const url of p.candidates) {
      try {
        const text = await fetchText(`${url}/${PLUGIN_INDEX_FILE}`, MAX_INDEX_TEXT);
        const idx = parseIndex(text);
        const now = Date.now();
        const src: MarketSource = { id: p.id, name: idx.name ?? p.name, url, link: link.trim(), added: now };
        this.store.putSource(src);
        this.store.put(IDX + src.id, text, now);
        this.keep(src.id, text, now);
        // 只为算出接受数与跳过原因; 别的源坏了不影响这次添加
        await this.merged().catch(() => []);
        return this.sources().find((s) => s.id === src.id)!;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
    }
    throw new ApiFail(400, CODE_BAD_REQUEST, `没找到能用的 index.json: ${last}`);
  }

  removeSource(id: string): boolean {
    for (const m of [this.loaded, this.skipped, this.counts]) m.delete(id);
    return id !== OFFICIAL_SOURCE && this.store.dropSource(id);
  }

  private keep(id: string, text: string, at: number, error?: string, retry?: number): Loaded {
    const l: Loaded = { at, entries: parseIndex(text).entries, ...(error ? { error, retry } : {}) };
    this.loaded.set(id, l);
    return l;
  }

  /** 一个源的索引: 内存 → 库 → 网络; 拉失败时用旧的 (时间仍是旧索引的) 并记下原因, 5 分钟后再试。 */
  private load(src: MarketSource, mode: FetchMode): Promise<Loaded> {
    const now = Date.now();
    const mem = this.loaded.get(src.id);
    if (mem) {
      const fresh = mode === "cache" ? now - mem.at < INDEX_TTL : mode === "force" ? false : now - mem.at < FRESH_REUSE;
      if (mode !== "force" && (mem.retry ? now < mem.retry : fresh)) return Promise.resolve(mem);
    }
    const row = this.store.get(IDX + src.id);
    if (mode === "cache" && !mem && row && now - row.at < INDEX_TTL) return Promise.resolve(this.keep(src.id, row.v, row.at));
    const busy = this.inflight.get(src.id);
    if (busy) return busy;
    const job = (async () => {
      try {
        const text = await fetchText(`${src.url}/${PLUGIN_INDEX_FILE}`, MAX_INDEX_TEXT);
        parseIndex(text);
        this.store.put(IDX + src.id, text, now);
        return this.keep(src.id, text, now);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        if (row) return this.keep(src.id, row.v, row.at, why, now + ERROR_TTL);
        const l: Loaded = { at: now, entries: [], error: why, retry: now + ERROR_TTL };
        this.loaded.set(src.id, l);
        return l;
      } finally {
        this.inflight.delete(src.id);
      }
    })();
    this.inflight.set(src.id, job);
    return job;
  }

  /** 合并各源: 先出现的 id 为准; 第三方源的 id 要带自己的命名空间。only: 只按 mode 重拉这个源, 别的走缓存。 */
  private async merged(mode: FetchMode = "cache", only?: string): Promise<Located[]> {
    const out: Located[] = [];
    const seen = new Map<string, string>();
    for (const src of this.sources()) {
      const skipped: string[] = [];
      const loaded = await this.load(src, only && only !== src.id ? "cache" : mode);
      for (const entry of loaded.entries) {
        const bad = src.official ? null : thirdPartyBad(entry.id);
        if (bad) skipped.push(`${entry.id}: ${bad}`);
        else if (seen.has(entry.id)) skipped.push(`${entry.id}: 与 ${seen.get(entry.id)} 撞名`);
        else {
          seen.set(entry.id, src.id);
          out.push({ src, entry });
        }
      }
      this.skipped.set(src.id, skipped);
      this.counts.set(src.id, loaded.entries.length - skipped.length);
    }
    // 一个源坏了不影响别的源; 全都拉不到才算市场不可用
    const errors = this.errors();
    if (!out.length && errors.length) throw new ApiFail(502, CODE_MARKET, errors.join("; "));
    return out;
  }

  /** 给客户端的列表: 去掉内嵌清单, 标上来源。 */
  async index(mode: FetchMode = "cache"): Promise<PluginEntry[]> {
    return (await this.merged(mode)).map(({ src, entry }) => {
      const { manifest: _m, ...e } = entry;
      return { ...e, source: src.id, ...(src.official ? {} : { sourceName: src.name }) };
    });
  }

  private async locate(id: string, mode: FetchMode): Promise<Located> {
    const find = (list: Located[]) => list.find((l) => l.entry.id === id);
    let hit = find(await this.merged());
    // 要最新时只重拉它所在的源; 缓存里没有 (可能是新上架的) 才各源都拉
    if (mode !== "cache") hit = find(await this.merged(mode, hit?.src.id));
    if (!hit) throw new ApiFail(404, CODE_NOT_FOUND, `市场里没有 ${id}`);
    return hit;
  }

  async sourceOf(id: string): Promise<MarketSource> {
    return (await this.locate(id, "cache")).src;
  }

  /**
   * cache: 全走缓存; latest: 重拉所在源的索引 (10 秒内复用), 文件版本没变仍用缓存, 管理员看详情用;
   * fresh: 全部重拉, 官方源放行时用。内嵌清单只信官方源 (CI 保证与 plugin.json 一致), 第三方一律读 plugin.json。
   * 返回清单和它所在的源 (放行记来源用同一份, 不另查)。
   */
  async manifestAt(id: string, mode: FetchMode = "cache"): Promise<{ m: PluginManifest; src: MarketSource }> {
    const fresh = mode === "fresh" || mode === "force";
    let { src, entry } = await this.locate(id, mode);
    if (!fresh && src.official && entry.manifest) return { m: this.check(id, entry.manifest, src), src };
    const key = (e: Entry, s: MarketSource) => `f:${s.id}:${id}@${e.version}/${PLUGIN_MANIFEST_FILE}`;
    const row = fresh ? null : this.store.get(key(entry, src));
    if (row) return { m: this.check(id, JSON.parse(row.v), src), src };
    let text = await fetchText(`${src.url}/${id}/${PLUGIN_MANIFEST_FILE}`, MAX_PLUGIN_TEXT);
    let m = this.check(id, JSON.parse(text), src);
    // 索引和清单在 CDN 上各缓存各的, 可能一新一旧: 强制重拉索引和清单各一次再比, 对上了才写缓存
    if (m.version !== entry.version) {
      ({ src, entry } = await this.locate(id, "force"));
      text = await fetchText(`${src.url}/${id}/${PLUGIN_MANIFEST_FILE}`, MAX_PLUGIN_TEXT);
      m = this.check(id, JSON.parse(text), src);
    }
    if (m.version !== entry.version) {
      const why = src.official ? "市场正在更新, 稍后再试" : "等源的作者修好";
      throw new ApiFail(409, CODE_CONFLICT, `${id} 的索引版本 ${entry.version} 与清单 ${m.version} 不一致, ${why}`);
    }
    this.store.put(key(entry, src), text, Date.now());
    return { m, src };
  }

  async manifest(id: string, mode: FetchMode = "cache"): Promise<PluginManifest> {
    return (await this.manifestAt(id, mode)).m;
  }

  private check(id: string, raw: unknown, src: MarketSource): PluginManifest {
    const m = parseManifest(raw);
    if (typeof m === "string") throw new ApiFail(400, CODE_BAD_REQUEST, `插件 ${id} 的 plugin.json 有误: ${m}`);
    if (m.id !== id) throw new ApiFail(400, CODE_BAD_REQUEST, `插件目录 ${id} 与 plugin.json 的 id 不一致`);
    // 服务端代码只能编进部署, 第三方源不能带
    if (m.server && !src.official) throw new ApiFail(400, CODE_BAD_REQUEST, `${id} 声明了服务端代码, 只有官方源能提供`);
    return m;
  }

  /**
   * 介绍与提示词, 按 "源 + 插件 + 索引里的版本" 缓存; fresh 时重拉并覆盖。
   * 版本内的文件无法自证版本: CDN 不同步时可能缓存到旧内容, 管理员在市场源页 "立即刷新" 会清掉文件缓存。
   */
  async file(id: string, name: string, fresh = false): Promise<string> {
    const { src, entry } = await this.locate(id, fresh ? "fresh" : "cache");
    const key = `f:${src.id}:${id}@${entry.version}/${name}`;
    const row = fresh ? null : this.store.get(key);
    if (row) return row.v;
    const text = await fetchText(`${src.url}/${id}/${name}`, MAX_PLUGIN_TEXT);
    this.store.put(key, text, Date.now());
    return text;
  }

  /** 管理员手动刷新: 每个源强制重拉索引, 清掉文件缓存。 */
  async refresh(): Promise<void> {
    this.store.dropFiles();
    await this.merged("force").catch(() => []);
  }

  /** 清单 + 提示词的摘要: 第三方插件放行时核对, 保证放行的就是管理员在详情里看过的那份。 */
  async digest(id: string): Promise<string> {
    const m = await this.manifest(id);
    return sha256(JSON.stringify(m) + "\n" + (m.prompt ? await this.file(id, m.prompt) : ""));
  }
}
