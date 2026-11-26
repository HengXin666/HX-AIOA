import { API_V1 } from "./constants";

// 多个市场源: 官方源固定第一个, 管理员在 App 里加别的 GitHub 仓库 (或任意放着 index.json 的目录)。
// 省请求: 索引每源 30 分钟拉一次, 落库后休眠重启也不用重拉; 清单可以内嵌在索引里; 介绍与提示词按版本号缓存, 版本不变就不再拉。
export const PATH_PLUGIN_SOURCES = `${API_V1}/plugin-sources`;
export const PATH_PLUGIN_SOURCE = `${API_V1}/plugin-sources/{id}`;
export const PATH_PLUGIN_SOURCES_REFRESH = `${API_V1}/plugin-sources-refresh`;
export const OFFICIAL_SOURCE = "official";
export const OFFICIAL_NAMESPACE = "hengxin666";
// 第三方源个数上限 (官方源不算)
export const MAX_SOURCES = 10;
// 索引可以内嵌清单, 比单个文件大
export const MAX_INDEX_TEXT = 256_000;

export type MarketSource = {
  id: string;
  name: string;
  // 拉 index.json 与插件目录的根地址
  url: string;
  // 管理员填的原始链接
  link: string;
  official?: true;
  added: number;
  // 最近一次拉到的索引: 时间, 插件数, 失败原因
  at?: number;
  count?: number;
  error?: string;
  // 被跳过的条目 (撞名, 冒用官方命名空间)
  skipped?: string[];
};
export type MarketSourceList = { sources: MarketSource[] };

const GH = "https://github.com/";
const RAW = "https://raw.githubusercontent.com/";
const DEFAULT_REF = "HEAD";
const DEFAULT_DIRS = ["", "plugins"];
const SEG_RE = /^[\w.-]+$/;
const MAX_ID = 64;

/** 填的链接 → 依次尝试的根地址 (第一个有 index.json 的就是), 和源 id。 */
export function parseMarketLink(raw: string, allowLocal = false): { id: string; name: string; candidates: string[] } | string {
  const link = raw.trim().replace(/\/index\.json$/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  // 本机 http 只给本地开发与 e2e 用, 由服务端按部署配置决定放不放
  if (!/^https:\/\//.test(link) && !(allowLocal && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(link))) return "只支持 https 链接";
  const join = (...p: string[]) => p.filter(Boolean).join("/");
  const idOf = (...p: string[]) => p.filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, MAX_ID);
  if (link.startsWith(GH) || link.startsWith(RAW)) {
    const raw = link.startsWith(RAW);
    const seg = link.slice(raw ? RAW.length : GH.length).split("/");
    const [owner, repo] = seg;
    if (!owner || !repo || !SEG_RE.test(owner) || !SEG_RE.test(repo)) return "认不出仓库, 填 https://github.com/<用户>/<仓库>";
    // github.com/o/r/tree/<分支>/<目录>; raw 链接是 o/r/<分支>/<目录>
    const rest = raw ? seg.slice(2) : seg[2] === "tree" || seg[2] === "blob" ? seg.slice(3) : seg.length > 2 ? null : [];
    if (rest === null) return "认不出链接, 填仓库首页或某个目录 (tree) 的链接";
    const ref = rest[0] ?? DEFAULT_REF;
    const dir = rest.slice(1).join("/");
    if (rest.some((s) => !SEG_RE.test(s))) return "链接里有不支持的字符";
    const base = join(RAW + owner, repo, ref);
    const candidates = rest.length > 1 ? [join(base, dir)] : DEFAULT_DIRS.map((d) => join(base, d));
    return { id: idOf(owner, repo, dir), name: `${owner}/${repo}${dir ? `/${dir}` : ""}`, candidates };
  }
  const u = (() => { try { return new URL(link); } catch { return null; } })();
  if (!u) return "链接格式不对";
  return { id: idOf(u.host, u.pathname), name: u.host + u.pathname, candidates: [link] };
}

/** 官方命名空间只能由官方源使用。 */
export const officialOnly = (id: string): boolean => id.split(".")[0] === OFFICIAL_NAMESPACE;
