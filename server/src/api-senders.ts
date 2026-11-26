import { PATH_SENDER, PATH_SENDERS, type ChatSyncFrame } from "@hx-aioa/protocol";
import { GET, PUT } from "./constants";
import { OWNER, ROOM, type ReqCtx, type Route, route } from "./core";
import { fail, json, pathParam, readJson } from "./http";

// 头像 id 是内容哈希的前 24 位十六进制 (见 api-chats putAvatar); 发送者 id 是来源 id
const AVATAR_RE = /^[0-9a-f]{24}$/;
const SID_MAX = 128;

/** 发送者头像 (#123): 主人设, 所有人看; 改了推 chat_sync senders, 客户端重拉。 */
function list(c: ReqCtx): Response {
  return json({ senders: c.core.chats.senders() });
}

async function put(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as { avatar?: unknown } | undefined;
  const sid = pathParam(c.params, 0);
  if (!sid || sid.length > SID_MAX) return fail(400, "发送者 id 不合法");
  const avatar = body?.avatar;
  if (avatar !== null && !(typeof avatar === "string" && AVATAR_RE.test(avatar))) return fail(400, "avatar 是上传头像得到的 id, 或 null 清掉");
  if (avatar !== null && !c.core.chats.avatar(avatar)) return fail(400, "头像不存在, 先上传");
  if (c.core.chats.setSender(sid, avatar)) c.core.sockets.toAllClients({ t: "chat_sync", topic: "senders" } satisfies ChatSyncFrame);
  return json({ senders: c.core.chats.senders() });
}

export const SENDER_ROUTES: Route[] = [route(GET, PATH_SENDERS, ROOM, list), route(PUT, PATH_SENDER, OWNER, put)];
