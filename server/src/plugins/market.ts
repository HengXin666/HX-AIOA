import { MAX_PLUGIN_TEXT, PLUGIN_INDEX_FILE, PLUGIN_MANIFEST_FILE, parseManifest, type PluginEntry, type PluginManifest } from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_NOT_FOUND } from "../constants";
import { ApiFail } from "../http";

// 官方市场就是仓库里的 plugins/ 目录, 公开只读
const DEFAULT_MARKET = "https://raw.githubusercontent.com/HengXin666/HX-AIOA/main/plugins";
const CACHE_MS = 5 * 60_000;
const UA = "hx-aioa-server/1";
const CODE_MARKET = "market_unavailable";

type Hit = { at: number; text: string };

/** 市场读取: 只在有人打开市场或安装时拉, 结果在内存里放 5 分钟, 不落库。 */
export class Market {
  private readonly cache = new Map<string, Hit>();

  constructor(private readonly base: string | undefined) {}

  private url(path: string): string {
    return `${(this.base || DEFAULT_MARKET).replace(/\/+$/, "")}/${path}`;
  }

  async text(path: string): Promise<string> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
    const res = await fetch(this.url(path), { headers: { "User-Agent": UA } }).catch(() => null);
    if (!res) throw new ApiFail(502, CODE_MARKET, "插件市场暂时连不上");
    if (res.status === 404) throw new ApiFail(404, CODE_NOT_FOUND, `市场里没有 ${path}`);
    if (!res.ok) throw new ApiFail(502, CODE_MARKET, `插件市场返回 HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_PLUGIN_TEXT) throw new ApiFail(502, CODE_MARKET, `${path} 超过 ${MAX_PLUGIN_TEXT} 字`);
    this.cache.set(path, { at: Date.now(), text });
    return text;
  }

  async index(): Promise<PluginEntry[]> {
    const raw = JSON.parse(await this.text(PLUGIN_INDEX_FILE)) as { plugins?: unknown };
    return Array.isArray(raw.plugins) ? (raw.plugins as PluginEntry[]).filter((p) => p && typeof p.id === "string") : [];
  }

  async manifest(id: string): Promise<PluginManifest> {
    const m = parseManifest(JSON.parse(await this.text(`${id}/${PLUGIN_MANIFEST_FILE}`)));
    if (typeof m === "string") throw new ApiFail(400, CODE_BAD_REQUEST, `插件 ${id} 的 plugin.json 有误: ${m}`);
    if (m.id !== id) throw new ApiFail(400, CODE_BAD_REQUEST, `插件目录 ${id} 与 plugin.json 的 id 不一致`);
    return m;
  }

  file(id: string, name: string): Promise<string> {
    return this.text(`${id}/${name}`);
  }
}
