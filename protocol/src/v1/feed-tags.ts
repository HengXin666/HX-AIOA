import { API_V1 } from "./constants";

// 信息流标签: 每个群自己定 (群主在群设置里改, Agent 只能在看过当前列表后追加);
// 没设置的群用默认四类。desc 是归类定义, 写进 Agent 的专属指令, 保证同一类东西只落进一个标签。
export const FEED_COLORS = ["orange", "blue", "green", "red", "purple", "teal", "pink", "gray"] as const;
export type FeedColor = (typeof FEED_COLORS)[number];
export type FeedTag = { id: string; label: string; desc: string; color?: FeedColor };
// 群里的标签表; rev 每次改动加一, Agent 追加时必须带上它看到的 rev
export type FeedTags = { tags: FeedTag[]; rev: number };
export type FeedTagAdd = { rev: number; tag: FeedTag };

export const DEFAULT_FEED_TAGS: FeedTag[] = [
  { id: "deal", label: "福利", desc: "能直接领到或省到钱的: 免费额度, 优惠, 兑换码, 抽奖, 公益站", color: "orange" },
  { id: "oss", label: "开源", desc: "可以拿来用的开源项目, 工具, 脚本, 模型 (就算发在福利区也算这里)", color: "blue" },
  { id: "news", label: "资讯", desc: "只用来了解的消息: 发布, 动态, 行业新闻, 政策", color: "green" },
  { id: "other", label: "其他", desc: "以上都不是", color: "gray" },
];

export const MAX_FEED_TAGS = 16;
const MAX_TAG_LABEL = 8;
const MAX_TAG_DESC = 120;
export const FEED_TAG_ID = /^[a-z][a-z0-9-]{0,15}$/;
export const PATH_AGENT_FEED_TAGS = `${API_V1}/chat-agent/feed-tags`;

/** 群里实际生效的标签表。 */
export function feedTagsOf(meta?: { feedTags?: FeedTag[]; feedRev?: number } | null): FeedTags {
  return { tags: meta?.feedTags?.length ? meta.feedTags : DEFAULT_FEED_TAGS, rev: meta?.feedRev ?? 0 };
}

export function tagLabel(tags: FeedTag[], id: string): string {
  return tags.find((t) => t.id === id)?.label ?? id;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseFeedTag(r: unknown, at = "tag"): FeedTag | string {
  if (!isObj(r)) return `${at} 需要是对象`;
  if (typeof r.id !== "string" || !FEED_TAG_ID.test(r.id)) return `${at}.id 需要小写字母开头, 只含 a-z 0-9 -, 最多 16 位`;
  if (typeof r.label !== "string" || !r.label.trim() || r.label.length > MAX_TAG_LABEL) return `${at}.label 必填 (不超过 ${MAX_TAG_LABEL} 字)`;
  if (typeof r.desc !== "string" || !r.desc.trim() || r.desc.length > MAX_TAG_DESC) return `${at}.desc 必填, 写清楚什么东西归这一类 (不超过 ${MAX_TAG_DESC} 字)`;
  if (r.color !== undefined && !(FEED_COLORS as readonly unknown[]).includes(r.color)) return `${at}.color 只能是 ${FEED_COLORS.join(" / ")}`;
  const out: FeedTag = { id: r.id, label: r.label.trim(), desc: r.desc.trim() };
  if (r.color) out.color = r.color as FeedColor;
  return out;
}

/** 群主整表替换: 顺序即优先级, id 不能重复。 */
export function parseFeedTags(v: unknown): FeedTag[] | string {
  if (!Array.isArray(v) || !v.length || v.length > MAX_FEED_TAGS) return `feedTags 需要 1 到 ${MAX_FEED_TAGS} 个标签`;
  const out: FeedTag[] = [];
  for (let i = 0; i < v.length; i++) {
    const t = parseFeedTag(v[i], `feedTags[${i}]`);
    if (typeof t === "string") return t;
    if (out.some((x) => x.id === t.id || x.label === t.label)) return `feedTags 里 ${t.id} / ${t.label} 重复`;
    out.push(t);
  }
  return out;
}

/** 推送里用了没声明的标签: 返回错误文字, 列出可用的。 */
export function checkFeedKinds(kinds: (string | undefined)[], tags: FeedTag[]): string | null {
  const bad = [...new Set(kinds.filter((k): k is string => !!k && !tags.some((t) => t.id === k)))];
  if (!bad.length) return null;
  return `本群没有标签 ${bad.join(", ")}; 可用: ${tags.map((t) => `${t.id} (${t.label})`).join(", ")}。确实都不合适时先 GET ${PATH_AGENT_FEED_TAGS} 再按说明追加`;
}
