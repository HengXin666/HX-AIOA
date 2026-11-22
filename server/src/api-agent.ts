import {
  PATH_AGENTS,
  PATH_AGENT_ACTIONS,
  PATH_AGENT_REGISTER,
  PATH_AGENT_TASKS,
  PATH_TASKS,
  QUERY_AGENT,
  QUERY_LIMIT,
  QUERY_STATE,
  TASK_STATES,
  parseAgentInfo,
  parseTaskOp,
  parseUserAction,
} from "@hx-aioa/protocol";
import { CODE_NOT_FOUND, ERR_NO_RESOURCE, GET, HISTORY_DEFAULT_LIMIT, OWNER_ID, POST, TASK_LOG_LIMIT } from "./constants";
import { OWNER, type ReqCtx, type Route, keyIdOf, route } from "./core";
import { badJson, clampInt, fail, json, readJson } from "./http";

const AGENT = "agent";

async function register(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as { agent?: unknown } | undefined;
  const info = parseAgentInfo(body?.agent);
  if (typeof info === "string") return fail(400, info);
  c.core.agents.register(info, keyIdOf(c.who), "http");
  return json({ ok: true, agent: c.core.agents.statuses().find((a) => a.id === info.id) });
}

async function taskOp(c: ReqCtx): Promise<Response> {
  const op = parseTaskOp(await readJson(c.req));
  if (typeof op === "string") return fail(400, op);
  const fallback = c.who.owner ? undefined : c.who.key.name;
  const caller = fallback ? { keyId: keyIdOf(c.who), agent: fallback } : { keyId: keyIdOf(c.who) };
  return json({ task: await c.core.agents.op(op, caller) });
}

// HTTP 模式的 Agent 轮询取动作, 顺带视为心跳
function pending(c: ReqCtx): Response {
  const agent = c.url.searchParams.get(QUERY_AGENT);
  if (!agent) return fail(400, "需要 agent 参数");
  const row = c.core.agents.statuses().find((a) => a.id === agent);
  if (row) c.core.agents.register({ id: row.id, name: row.name, ...(row.icon ? { icon: row.icon } : {}), ...(row.desc ? { desc: row.desc } : {}) }, keyIdOf(c.who), "http");
  return json({ actions: c.core.agents.takePending(agent) });
}

function ack(c: ReqCtx): Response {
  c.core.agents.ack(decodeURIComponent(c.params[0] ?? ""), { keyId: keyIdOf(c.who) });
  return json({ ok: true });
}

function listTasks(c: ReqCtx): Response {
  const state = c.url.searchParams.get(QUERY_STATE);
  if (state && !(TASK_STATES as readonly string[]).includes(state)) return fail(400, "state 取值错误");
  const limit = clampInt(c.url.searchParams.get(QUERY_LIMIT), HISTORY_DEFAULT_LIMIT, TASK_LOG_LIMIT);
  return json({ tasks: c.core.agents.list(state, limit) });
}

function taskDetail(c: ReqCtx): Response {
  const d = c.core.agents.detail(decodeURIComponent(c.params[0] ?? ""), TASK_LOG_LIMIT);
  return d ? json(d) : fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
}

async function userAction(c: ReqCtx): Promise<Response> {
  const body = await readJson(c.req);
  if (typeof body !== "object" || body === null) return badJson();
  const input = parseUserAction({ ...body, taskId: decodeURIComponent(c.params[0] ?? "") });
  if (typeof input === "string") return fail(400, input);
  return json(await c.core.agents.act(input, OWNER_ID));
}

export const AGENT_ROUTES: Route[] = [
  route(POST, PATH_AGENT_REGISTER, AGENT, register),
  route(POST, PATH_AGENT_TASKS, AGENT, taskOp),
  route(GET, PATH_AGENT_ACTIONS, AGENT, pending),
  route(POST, `${PATH_AGENT_ACTIONS}/{aid}/ack`, AGENT, ack),
  route(GET, PATH_AGENTS, OWNER, (c) => json({ agents: c.core.agents.statuses() })),
  route(GET, PATH_TASKS, OWNER, listTasks),
  route(GET, `${PATH_TASKS}/{id}`, OWNER, taskDetail),
  route(POST, `${PATH_TASKS}/{id}/actions`, OWNER, userAction),
];
