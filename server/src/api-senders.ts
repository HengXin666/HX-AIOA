import { PATH_SENDER, PATH_SENDERS, type ChatSyncFrame, type SenderPatch } from "@hx-aioa/protocol";
import { GET, PATCH, PUT } from "./constants";
import { OWNER, ROOM, type ReqCtx, type Route, route } from "./core";
import { fail, json, pathParam, readJson } from "./http";
import type { SenderStore } from "./senders";

// 头像 id 是内容哈希的前 24 位十六进制 (见 api-chats putAvatar)
const AVATAR_RE = /^[0-9a-f]{24}$/;

// 群 Agent 等 Agent 来源 (#121): 和系统发送者一样登记, 主人能改名换头像
const AGENT_TYPE = "agent";

function syncAgents(c: ReqCtx, s: SenderStore): void {
  s.syncAgents(c.core.registry.sources().filter((x) => x.type === AGENT_TYPE).map((x) => ({ id: x.id, name: x.name, created: x.created })));
}

/** 系统发送者 (#128) 与 Agent 来源 (#121): 列全部登记的 (第一次列时补登历史), 主人改名 / 换头像, 改了推 chat_sync senders。 */
function list(c: ReqCtx): Response {
  const s = c.core.pipeline.senders;
  if (!s) return json({ senders: [] });
  s.backfill();
  syncAgents(c, s);
  return json({ senders: s.list() });
}

function parse(raw: unknown): SenderPatch | string {
  if (!raw || typeof raw !== "object") return "请求体必须是 JSON 对象";
  const r = raw as Record<string, unknown>;
  const out: SenderPatch = {};
  if ("alias" in r) {
    if (r.alias !== null && typeof r.alias !== "string") return "alias 是名字, 或 null 恢复默认";
    out.alias = r.alias as string | null;
  }
  if ("avatar" in r) {
    if (r.avatar !== null && !(typeof r.avatar === "string" && AVATAR_RE.test(r.avatar))) return "avatar 是上传头像得到的 id, 或 null 恢复默认";
    out.avatar = r.avatar as string | null;
  }
  return Object.keys(out).length ? out : "没有要改的: alias 或 avatar";
}

async function patch(c: ReqCtx): Promise<Response> {
  const s = c.core.pipeline.senders;
  const p = parse(await readJson(c.req));
  if (typeof p === "string") return fail(400, p);
  if (p.avatar && !c.core.chats.avatar(p.avatar)) return fail(400, "头像不存在, 先上传");
  s?.backfill();
  if (s) syncAgents(c, s);
  const r = s?.patch(pathParam(c.params, 0), p) ?? null;
  if (r === null) return fail(404, "没有这个系统发送者或 Agent");
  if (typeof r === "string") return fail(400, r);
  c.core.sockets.toAllClients({ t: "chat_sync", topic: "senders" } satisfies ChatSyncFrame);
  return json({ sender: r });
}

// PUT 与 PATCH 同义 (#123 的客户端用 PUT 只改头像)
export const SENDER_ROUTES: Route[] = [route(GET, PATH_SENDERS, ROOM, list), route(PATCH, PATH_SENDER, OWNER, patch), route(PUT, PATH_SENDER, OWNER, patch)];
