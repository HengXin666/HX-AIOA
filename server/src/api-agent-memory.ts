import { AGENT_MEMORY_MAX, PATH_AGENT_MEMORY } from "@hx-aioa/protocol";
import { agentMe } from "./api-presence";
import { CODE_FORBIDDEN, ERR_FORBIDDEN, GET, PUT } from "./constants";
import { ROOM, type ReqCtx, type Route, route } from "./core";
import { fail, json, readJson } from "./http";

// Agent 记忆按来源存: 轮换密钥后还是同一个 Agent
function whoOf(c: ReqCtx): string | null {
  if (c.who.owner || c.who.member) return null;
  const me = agentMe(c.core, c.who.key);
  return me.sourceId || c.who.key.id;
}

function getMemory(c: ReqCtx): Response {
  const who = whoOf(c);
  if (!who) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  return json(c.core.chats.memory(who));
}

// 整段覆盖; 空字符串清空
async function putMemory(c: ReqCtx): Promise<Response> {
  const who = whoOf(c);
  if (!who) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const body = (await readJson(c.req)) as { text?: unknown } | undefined;
  const text = typeof body?.text === "string" ? body.text.trim() : null;
  if (text === null) return fail(400, "需要 {\"text\": \"...\"}");
  if (text.length > AGENT_MEMORY_MAX) return fail(400, `记忆最多 ${AGENT_MEMORY_MAX} 字, 现在 ${text.length} 字: 合并旧条目再存`);
  return json(c.core.chats.setMemory(who, text));
}

export const MEMORY_ROUTES: Route[] = [route(GET, PATH_AGENT_MEMORY, ROOM, getMemory), route(PUT, PATH_AGENT_MEMORY, ROOM, putMemory)];
