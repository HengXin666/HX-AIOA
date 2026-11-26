import {
  MAX_INDEX_TEXT,
  MAX_PLUGIN_TEXT,
  MAX_SOURCES,
  OFFICIAL_SOURCE,
  PLUGIN_INDEX_FILE,
  PLUGIN_MANIFEST_FILE,
  officialOnly,
  parseManifest,
  parseMarketLink,
  type MarketSource,
  type PluginEntry,
  type PluginIndex,
  type PluginManifest,
} from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_CONFLICT, CODE_NOT_FOUND } from "../constants";
import { ApiFail } from "../http";
import { MarketStore } from "./market-store";

// 官方市场就是仓库里的 plugins/ 目录, 公开只读
const DEFAULT_MARKET = "https://raw.githubusercontent.com/HengXin666/HX-AIOA/main/plugins";
// 索引每源 30 分钟最多拉一次 (落库, 休眠重启不重拉); 文件按版本缓存, 版本不变不再拉
const INDEX_TTL = 30 * 60_000;
// 一次放行里会连着要好几次 "最新": 10 秒内拉过的索引就算最新 (管理员看详情的 latest 每次都拉)
const FRESH_REUSE = 10_000;
// 源连不上时隔 5 分钟再试, 期间用旧索引
const ERROR_TTL = 5 * 60_000;
const UA = "hx-aioa-server/1";
const CODE_MARKET = "market_unavailable";

type Entry = PluginEntry & { manifest?: unknown };
type Loaded = { at: number; entries: Entry[]; error?: string };
type Located = { src: MarketSource; entry: Entry };
export type FetchMode = "cache" | "latest" | "fresh";

async function fetchText(url: string, max: number): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
  if (!res) throw new ApiFail(502, CODE_MARKET, "插件市场暂时连不上");
  if (res.status === 404) throw new ApiFail(404, CODE_NOT_FOUND, `市场里没有 ${url.split("/").slice(-2).join("/")}`);
  if (!res.ok) throw new ApiFail(502, CODE_MARKET, `插件市场返回 HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > max) throw new ApiFail(502, CODE_MARKET, `${url.split("/").pop()} 超过 ${max} 字`);
  return text;
}

function parseIndex(text: string): { name?: string; entries: Entry[] } {
  const raw = JSON.parse(text) as Partial<PluginIndex>;
  const entries = Array.isArray(raw.plugins) ? raw.plugins.filter((p): p is Entry => !!p && typeof p.id === "string" && typeof p.version === "string") : [];
  return { ...(typeof raw.name === "string" ? { name: raw.name } : {}), entries };
}

/** 多源市场: 只在有人打开市场, 看详情或放行时拉, 结果落库按版本复用。 */
export class Market {
  private readonly store: MarketStore;
  private readonly loaded = new Map<string, Loaded>();
  private readonly skipped = new Map<string, string[]>();

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
      return { ...s, ...(l ? { at: l.at, count: l.entries.length } : {}), ...(l?.error ? { error: l.error } : {}), ...(skipped?.length ? { skipped } : {}) };
    });
  }

  /** 加一个源: 依次试候选目录的 index.json (最多两次请求), 第一个能解析的就是。 */
  async addSource(link: string): Promise<MarketSource> {
    const p = parseMarketLink(link);
    if (typeof p === "string") throw new ApiFail(400, CODE_BAD_REQUEST, p);
    const all = this.sources();
    if (all.length > MAX_SOURCES) throw new ApiFail(400, CODE_BAD_REQUEST, `最多 ${MAX_SOURCES} 个市场源`);
    if (all.some((s) => s.id === p.id)) throw new ApiFail(409, CODE_CONFLICT, "这个源已经加过了");
    let last = "";
    for (const url of p.candidates) {
      try {
        const text = await fetchText(`${url}/${PLUGIN_INDEX_FILE}`, MAX_INDEX_TEXT);
        const idx = parseIndex(text);
        const src: MarketSource = { id: p.id, name: idx.name ?? p.name, url, link: link.trim(), added: Date.now() };
        this.store.putSource(src);
        this.keep(src.id, text, Date.now());
        return this.sources().find((s) => s.id === src.id)!;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
    }
    throw new ApiFail(400, CODE_BAD_REQUEST, `没找到能用的 index.json: ${last}`);
  }

  removeSource(id: string): boolean {
    this.loaded.delete(id);
    this.skipped.delete(id);
    return id !== OFFICIAL_SOURCE && this.store.dropSource(id);
  }

  private keep(id: string, text: string, at: number, error?: string): Loaded {
    const l: Loaded = { at, entries: parseIndex(text).entries, ...(error ? { error } : {}) };
    this.loaded.set(id, l);
    return l;
  }

  /** 一个源的索引: 内存 → 库 → 网络; 拉失败时用旧的并记下原因。 */
  private async load(src: MarketSource, mode: FetchMode): Promise<Loaded> {
    const now = Date.now();
    const mem = this.loaded.get(src.id);
    const ttl = mode === "latest" ? 0 : mode === "fresh" ? FRESH_REUSE : mem?.error ? ERROR_TTL : INDEX_TTL;
    if (mem && now - mem.at < ttl) return mem;
    const row = this.store.get(`idx:${src.id}`);
    if (mode === "cache" && row && now - row.at < INDEX_TTL) return this.keep(src.id, row.v, row.at);
    try {
      const text = await fetchText(`${src.url}/${PLUGIN_INDEX_FILE}`, MAX_INDEX_TEXT);
      parseIndex(text);
      this.store.put(`idx:${src.id}`, text, now);
      return this.keep(src.id, text, now);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (row) return this.keep(src.id, row.v, now, why);
      const l: Loaded = { at: now, entries: [], error: why };
      this.loaded.set(src.id, l);
      return l;
    }
  }

  /** 合并各源: 先出现的 id 为准; 非官方源不能用官方命名空间。 */
  private async merged(mode: FetchMode = "cache"): Promise<Located[]> {
    const out: Located[] = [];
    const seen = new Map<string, string>();
    for (const src of this.sources()) {
      const skipped: string[] = [];
      for (const entry of (await this.load(src, mode)).entries) {
        if (!src.official && officialOnly(entry.id)) skipped.push(`${entry.id}: 官方命名空间`);
        else if (seen.has(entry.id)) skipped.push(`${entry.id}: 与 ${seen.get(entry.id)} 撞名`);
        else {
          seen.set(entry.id, src.id);
          out.push({ src, entry });
        }
      }
      this.skipped.set(src.id, skipped);
    }
    // 一个源坏了不影响别的源; 全都拉不到才算市场不可用
    const errors = this.sources().filter((s) => s.error).map((s) => `${s.name}: ${s.error}`);
    if (!out.length && errors.length) throw new ApiFail(502, CODE_MARKET, errors.join("; "));
    return out;
  }

  /** 拉失败的源 (已用旧索引或跳过), 列表页提示用。 */
  errors(): string[] {
    return this.sources().filter((s) => s.error).map((s) => `${s.name}: ${s.error}`);
  }

  /** 给客户端的列表: 去掉内嵌清单, 标上来源。 */
  async index(mode: FetchMode = "cache"): Promise<PluginEntry[]> {
    return (await this.merged(mode)).map(({ src, entry }) => {
      const { manifest: _m, ...e } = entry;
      return { ...e, source: src.id, ...(src.official ? {} : { sourceName: src.name }) };
    });
  }

  private async locate(id: string, mode: FetchMode): Promise<Located> {
    const hit = (await this.merged(mode)).find((l) => l.entry.id === id);
    if (!hit) throw new ApiFail(404, CODE_NOT_FOUND, `市场里没有 ${id}`);
    return hit;
  }

  async sourceOf(id: string): Promise<MarketSource> {
    return (await this.locate(id, "cache")).src;
  }

  /**
   * cache: 全走缓存; latest: 重拉索引 (10 秒内复用), 文件版本没变仍用缓存, 管理员看详情用;
   * fresh: 全部重拉, 放行时用。没 fresh 时优先用索引里内嵌的清单。
   */
  async manifest(id: string, mode: FetchMode = "cache"): Promise<PluginManifest> {
    const fresh = mode === "fresh";
    const { src, entry } = await this.locate(id, mode);
    const raw = !fresh && entry.manifest ? entry.manifest : JSON.parse(await this.file(id, PLUGIN_MANIFEST_FILE, fresh));
    const m = parseManifest(raw);
    if (typeof m === "string") throw new ApiFail(400, CODE_BAD_REQUEST, `插件 ${id} 的 plugin.json 有误: ${m}`);
    if (m.id !== id) throw new ApiFail(400, CODE_BAD_REQUEST, `插件目录 ${id} 与 plugin.json 的 id 不一致`);
    // 服务端代码只能编进部署, 第三方源不能带
    if (m.server && !src.official) throw new ApiFail(400, CODE_BAD_REQUEST, `${id} 声明了服务端代码, 只有官方源能提供`);
    return m;
  }

  /** 插件目录里的文件, 按 "源 + 插件 + 索引里的版本" 缓存; fresh 时重拉并覆盖。 */
  async file(id: string, name: string, fresh = false): Promise<string> {
    const { src, entry } = await this.locate(id, fresh ? "fresh" : "cache");
    const key = `f:${src.id}:${id}@${entry.version}/${name}`;
    const row = fresh ? null : this.store.get(key);
    if (row) return row.v;
    const text = await fetchText(`${src.url}/${id}/${name}`, MAX_PLUGIN_TEXT);
    this.store.put(key, text, Date.now());
    return text;
  }
}
