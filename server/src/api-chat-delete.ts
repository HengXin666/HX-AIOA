import { MAX_ID_LENGTH, PATH_CHAT, type ChatCleared } from "@hx-aioa/protocol";
import { syncChat } from "./chat-sync";
import { dropAgent } from "./api-chats";
import { DELETE } from "./constants";
import { OWNER, type Core, type ReqCtx, type Route, route } from "./core";
import { fail, json } from "./http";

/**
 * 删除群 (母号): 消息, 文件, 接入的 Agent (key 作废), 插件安装与工作台, 待办, 多人群成员与邀请一并删掉,
 * 群资料只留一行墓碑 (deleted + cleared), 各端据此删本地记录并隐藏这个群。
 */
export async function deleteGroup(core: Core, channel: string, now = Date.now()): Promise<ChatCleared> {
  const meta = core.chats.chat(channel);
  for (const a of meta?.agents ?? []) dropAgent(core, channel, a.keyId);
  for (const p of core.plugins.list().filter((x) => x.channel === channel)) {
    if (p.space && (await core.spaces.remove(p.space))) core.sockets.toV1Clients({ t: "space_update", id: p.space, deleted: true });
    core.plugins.remove(p.id);
  }
  for (const t of core.todos.list(channel)) core.todos.remove(channel, t.id);
  const members = core.rooms.members(channel).map((m) => m.member);
  core.rooms.dropRoom(channel);
  core.chats.reads.dropChannel(channel);
  const head = core.store.head();
  const deleted = core.store.clearGroup(channel, head + 1);
  await core.files.dropGroup(channel);
  const cleared = Math.max(meta?.cleared ?? 0, head);
  core.chats.replaceChat({ channel, cleared, deleted: now, updated: now });
  syncChat(core, channel, { also: members });
  return { deleted, cleared };
}

async function handle(c: ReqCtx): Promise<Response> {
  const channel = decodeURIComponent(c.params[0] ?? "");
  if (!channel || channel.length > MAX_ID_LENGTH) return fail(400, "群名不合法");
  return json(await deleteGroup(c.core, channel));
}

export const CHAT_DELETE_ROUTES: Route[] = [route(DELETE, PATH_CHAT, OWNER, handle)];
