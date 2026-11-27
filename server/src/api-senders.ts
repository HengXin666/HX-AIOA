import { PATH_SENDER, PATH_SENDERS, type ChatSyncFrame, type SenderMeta, type SenderPatch } from "@hx-aioa/protocol";
import { dropAgentAlias } from "./agent-name";
import { guideFor } from "./agent-sync";
import { saveAgents } from "./api-chats";
import { baseOf } from "./api-rooms";
import { GET, PATCH, PUT } from "./constants";
import { type Core, OWNER, ROOM, type ReqCtx, type Route, route } from "./core";
import { fail, json, pathParam, readJson } from "./http";
import { isSystemSender, type SenderStore } from "./senders";

// 头像 id 是内容哈希的前 24 位十六进制 (见 api-chats putAvatar)
const AVATAR_RE = /^[0-9a-f]{24}$/;

// 群 Agent 等 Agent 来源 (#121): 和系统发送者一样登记, 主人能改名换头像
const AGENT_TYPE = "agent";

function syncAgents(c: ReqCtx, s: SenderStore): void {
  s.syncAgents(c.core.registry.sources().filter((x) => x.type === AGENT_TYPE).map((x) => ({ id: x.id, name: x.name, created: x.created })));
}

/**
 * 给列表行标上身份 (#139): 现有的群 Agent 标 agent; 来源已删的 (移出的 Agent) 标 gone,
 * 行留着是为了旧消息的头像, 设置页不再列出。
 */
export function markSenders(core: Core, list: SenderMeta[]): SenderMeta[] {
  const sources = new Map(core.registry.sources().map((x) => [x.id, x.type]));
  return list.map((m) => {
    if (isSystemSender(m.sid)) return m;
    const type = sources.get(m.sid);
    if (type === undefined) return { ...m, gone: true };
    return type === AGENT_TYPE ? { ...m, agent: true } : m;
  });
}

/** 系统发送者 (#128) 与 Agent 来源 (#121): 列全部登记的 (第一次列时补登历史), 主人改名 / 换头像, 改了推 chat_sync senders。 */
function list(c: ReqCtx): Response {
  const s = c.core.pipeline.senders;
  if (!s) return json({ senders: [] });
  s.backfill();
  syncAgents(c, s);
  return json({ senders: markSenders(c.core, s.list()) });
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

const NAME_MAX = 32;

/** 给群 Agent 改名 (#139): 改的是 Agent 本身的名字 (和 Agent 设置里的 "名字" 同一处), 不另存别名。 */
function renameAgent(c: ReqCtx, sid: string, name: string): string | null {
  const src = c.core.registry.source(sid);
  if (src?.type !== AGENT_TYPE || !src.channel) return null;
  if (name.length > NAME_MAX) return `名字最多 ${NAME_MAX} 字`;
  const meta = c.core.chats.chat(src.channel);
  const old = meta?.agents?.find((a) => a.sourceId === sid);
  if (!meta || !old) return null;
  const agent = { ...old, name };
  const base = baseOf(c.url);
  if (guideFor(c.core, base, src.channel, agent).version !== guideFor(c.core, base, src.channel, old).version) agent.pending = true;
  c.core.registry.saveSource({ ...src, name });
  const key = c.core.registry.key(old.keyId);
  if (key) c.core.registry.saveKey({ ...key, name });
  saveAgents(c.core, src.channel, (meta.agents ?? []).map((x) => (x.keyId === old.keyId ? agent : x)));
  dropAgentAlias(c.core, sid, name);
  return "";
}

async function patch(c: ReqCtx): Promise<Response> {
  const s = c.core.pipeline.senders;
  const p = parse(await readJson(c.req));
  if (typeof p === "string") return fail(400, p);
  if (p.avatar && !c.core.chats.avatar(p.avatar)) return fail(400, "头像不存在, 先上传");
  s?.backfill();
  if (s) syncAgents(c, s);
  const sid = pathParam(c.params, 0);
  const alias = p.alias?.trim();
  if (alias) {
    const err = renameAgent(c, sid, alias);
    if (err) return fail(400, err);
    if (err === "") delete p.alias;
  }
  const r = Object.keys(p).length ? (s?.patch(sid, p) ?? null) : (s?.get(sid) ?? null);
  if (r === null) return fail(404, "没有这个系统发送者或 Agent");
  if (typeof r === "string") return fail(400, r);
  c.core.sockets.toAllClients({ t: "chat_sync", topic: "senders" } satisfies ChatSyncFrame);
  return json({ sender: markSenders(c.core, [r])[0] });
}

// PUT 与 PATCH 同义 (#123 的客户端用 PUT 只改头像)
export const SENDER_ROUTES: Route[] = [route(GET, PATH_SENDERS, ROOM, list), route(PATCH, PATH_SENDER, OWNER, patch), route(PUT, PATH_SENDER, OWNER, patch)];
