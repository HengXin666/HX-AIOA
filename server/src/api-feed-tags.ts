import { feedTagsOf, MAX_FEED_TAGS, parseFeedTag, PATH_AGENT_FEED_TAGS, type Scope } from "@hx-aioa/protocol";
import { syncChats } from "./api-rooms";
import { agentByKey } from "./api-chats";
import { GET, POST } from "./constants";
import { type ReqCtx, type Route, route } from "./core";
import { fail, json, readJson } from "./http";

const SEND_SCOPE: Scope = "messages:send";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Agent 看本群标签表: 追加前必须先拿到 rev
function listTags(c: ReqCtx): Response {
  const { meta } = agentByKey(c);
  return json(feedTagsOf(meta));
}

// Agent 追加一个标签: rev 必须是它刚看到的, 不能改名或删除已有的 (群主在群设置里改)
async function addTag(c: ReqCtx): Promise<Response> {
  const { channel, meta } = agentByKey(c);
  const raw = await readJson(c.req);
  if (!isObj(raw) || typeof raw.rev !== "number") return fail(400, `需要 {rev, tag}; 先 GET ${PATH_AGENT_FEED_TAGS} 拿当前 rev`);
  const cur = feedTagsOf(meta);
  if (raw.rev !== cur.rev) return fail(409, `标签表已更新到 rev ${cur.rev}, 请重新 GET ${PATH_AGENT_FEED_TAGS} 看过再决定`);
  const tag = parseFeedTag(raw.tag);
  if (typeof tag === "string") return fail(400, tag);
  const dup = cur.tags.find((t) => t.id === tag.id || t.label === tag.label);
  if (dup) return fail(409, `已有标签 ${dup.id} (${dup.label}), 直接用它`);
  if (cur.tags.length >= MAX_FEED_TAGS) return fail(400, `标签已满 ${MAX_FEED_TAGS} 个, 请主人整理`);
  const next = c.core.chats.patchChat(channel, { feedTags: [...cur.tags, tag], feedRev: cur.rev + 1 } as never);
  syncChats(c.core, channel);
  return json(feedTagsOf(next));
}

export const FEED_TAG_ROUTES: Route[] = [route(GET, PATH_AGENT_FEED_TAGS, SEND_SCOPE, listTags), route(POST, PATH_AGENT_FEED_TAGS, SEND_SCOPE, addTag)];
