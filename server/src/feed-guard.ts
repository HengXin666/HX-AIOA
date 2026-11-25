import { checkFeedKinds, feedTagsOf, PATH_AGENT_GUIDE, PATH_MESSAGES, type ChatMeta, type FeedData } from "@hx-aioa/protocol";

export const CODE_FEED_REQUIRED = "feed_required";
const CODE_BAD_KIND = "bad_request";
const UNPROCESSABLE = 422;
const BAD_REQUEST = 400;

export type FeedReject = { status: number; code: string; text: string };

/**
 * 信息流群的写入检查: feed 的标签必须在群标签表里; 外接 Agent 发 HTML 卡片直接拒收,
 * 错误里写清楚该怎么发, 不然它们会一直按自己存的旧模板发 HTML。
 */
export function feedGuard(meta: ChatMeta | null | undefined, data: Record<string, unknown> | undefined, owner: boolean): FeedReject | null {
  if (meta?.view !== "feed") return null;
  const tags = feedTagsOf(meta).tags;
  const feed = data?.feed as FeedData | undefined;
  if (feed) {
    const bad = checkFeedKinds(feed.items.map((it) => it.kind), tags);
    return bad ? { status: BAD_REQUEST, code: CODE_BAD_KIND, text: bad } : null;
  }
  if (owner || !data?.html) return null;
  const example = { feed: { source: "来源名", items: [{ id: "帖子 id", title: "标题", url: "https://...", kind: tags[0]?.id ?? "other", status: "ok", summary: "一句结论" }] } };
  const text = [
    `群 "${meta.title || meta.channel}" 按信息流展示, 不收 HTML 卡片, 这条没有发出去。`,
    `把这一批改成一条 feed 消息重发: POST ${PATH_MESSAGES} ${JSON.stringify(example)}`,
    `kind 只能用: ${tags.map((t) => `${t.id} (${t.label})`).join(", ")}。`,
    `完整规则: GET ${PATH_AGENT_GUIDE} (或 hxaioa guide --ack), 用它替换你保存的旧指令和 HTML 模板。`,
  ].join("\n");
  return { status: UNPROCESSABLE, code: CODE_FEED_REQUIRED, text };
}
