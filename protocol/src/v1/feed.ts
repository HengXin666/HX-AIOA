// 统一推送卡片: 推送源只给结构化条目, 由各端原生画, 跟随主题; 不再各写一份 HTML。
// 放在事件 data.feed 里; text / title 仍是一句摘要, 给通知和列表用 (不写则由服务端按条目生成)。

export const FEED_KINDS = ["deal", "oss", "news", "other"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];
export const FEED_KIND_LABEL: Record<FeedKind, string> = { deal: "福利", oss: "开源", news: "资讯", other: "其他" };
// ok 有效, go 进行中, doubt 存疑, dead 失效
export const FEED_STATUSES = ["ok", "go", "doubt", "dead"] as const;
export type FeedStatus = (typeof FEED_STATUSES)[number];
export const FEED_STATUS_LABEL: Record<FeedStatus, string> = { ok: "有效", go: "进行中", doubt: "存疑", dead: "失效" };

export type FeedLink = { label: string; url: string };
/**
 * 一条: title 必填; id 用于跨批次去重 (不写用 url); site 为来源站点域名 (不写取 url 的域名, 用来显示网站图标);
 * todo 是 "要做什么才能拿到"; until 是截止日期 (如 2026-11-30); heat 是热度 (回复数之类)。
 */
export type FeedItem = {
  title: string;
  id?: string;
  url?: string;
  site?: string;
  kind?: FeedKind;
  status?: FeedStatus;
  summary?: string;
  todo?: string;
  until?: string;
  heat?: number;
  links?: FeedLink[];
};
// source: 推送源名字 (LinuxDO, NodeLoc), 不写用发送方来源名
export type FeedData = { source?: string; items: FeedItem[] };

export const MAX_FEED_ITEMS = 50;
const MAX_FEED_TITLE = 200;
const MAX_FEED_SUMMARY = 400;
const MAX_FEED_TODO = 200;
const MAX_FEED_SHORT = 80;
const MAX_FEED_URL = 2000;
const MAX_FEED_LINKS = 4;
const URL_RE = /^https?:\/\//i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const optStr = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);
const isUrl = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_FEED_URL && URL_RE.test(v);

function parseItem(r: unknown, i: number): FeedItem | string {
  const at = `feed.items[${i}]`;
  if (!isObj(r)) return `${at} 需要是对象`;
  if (typeof r.title !== "string" || !r.title.trim() || r.title.length > MAX_FEED_TITLE) return `${at}.title 必填 (不超过 ${MAX_FEED_TITLE} 字)`;
  if (r.url !== undefined && !isUrl(r.url)) return `${at}.url 需要 http(s) 链接`;
  if (r.kind !== undefined && !(FEED_KINDS as readonly unknown[]).includes(r.kind)) return `${at}.kind 只能是 ${FEED_KINDS.join(" / ")}`;
  if (r.status !== undefined && !(FEED_STATUSES as readonly unknown[]).includes(r.status)) return `${at}.status 只能是 ${FEED_STATUSES.join(" / ")}`;
  if (!optStr(r.summary, MAX_FEED_SUMMARY) || !optStr(r.todo, MAX_FEED_TODO)) return `${at} summary / todo 过长`;
  if (!optStr(r.id, MAX_FEED_SHORT) || !optStr(r.site, MAX_FEED_SHORT) || !optStr(r.until, MAX_FEED_SHORT)) return `${at} id / site / until 过长`;
  if (r.heat !== undefined && (typeof r.heat !== "number" || !Number.isFinite(r.heat))) return `${at}.heat 需要数字`;
  const out: FeedItem = { title: r.title.trim() };
  for (const k of ["id", "url", "summary", "todo", "until"] as const) if (typeof r[k] === "string" && r[k]) out[k] = r[k] as string;
  if (r.kind) out.kind = r.kind as FeedKind;
  if (r.status) out.status = r.status as FeedStatus;
  if (typeof r.heat === "number") out.heat = r.heat;
  const site = typeof r.site === "string" && r.site ? r.site : out.url ? hostOf(out.url) : "";
  if (site) out.site = site.toLowerCase();
  if (r.links !== undefined) {
    if (!Array.isArray(r.links) || r.links.length > MAX_FEED_LINKS) return `${at}.links 最多 ${MAX_FEED_LINKS} 个`;
    const links: FeedLink[] = [];
    for (const l of r.links) {
      if (!isObj(l) || typeof l.label !== "string" || !l.label || l.label.length > MAX_FEED_SHORT || !isUrl(l.url)) return `${at}.links 每项需要 label 与 http(s) url`;
      links.push({ label: l.label, url: l.url });
    }
    if (links.length) out.links = links;
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function parseFeed(v: unknown): FeedData | string {
  if (!isObj(v) || !Array.isArray(v.items)) return "feed 需要 items 数组";
  if (!v.items.length || v.items.length > MAX_FEED_ITEMS) return `feed.items 需要 1 到 ${MAX_FEED_ITEMS} 条`;
  if (!optStr(v.source, MAX_FEED_SHORT)) return "feed.source 过长";
  const items: FeedItem[] = [];
  for (let i = 0; i < v.items.length; i++) {
    const it = parseItem(v.items[i], i);
    if (typeof it === "string") return it;
    items.push(it);
  }
  const out: FeedData = { items };
  if (typeof v.source === "string" && v.source) out.source = v.source;
  return out;
}

/** 通知用的一句话: "新到 19 条: 福利 10 (有效 2) · 开源 2 | 第一条标题"。 */
export function feedText(f: FeedData): string {
  const by = new Map<FeedKind, number>();
  for (const it of f.items) by.set(it.kind ?? "other", (by.get(it.kind ?? "other") ?? 0) + 1);
  const ok = f.items.filter((it) => it.kind === "deal" && (it.status === "ok" || it.status === "go")).length;
  const parts = FEED_KINDS.filter((k) => by.has(k)).map((k) => `${FEED_KIND_LABEL[k]} ${by.get(k)}${k === "deal" && ok ? ` (有效 ${ok})` : ""}`);
  const head = `${f.source ? `${f.source} ` : ""}新到 ${f.items.length} 条: ${parts.join(" · ")}`;
  return `${head}\n${f.items.slice(0, 2).map((it) => it.title).join(", ")}`;
}
