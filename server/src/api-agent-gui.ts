import { PATH_AGENT_GUI_INBOX, PATH_AGENT_GUI_PAIR, parseAgPairDevice, type AgInboxResponse, type AgPairResponse } from "@hx-aioa/protocol";
import { ownerPassword } from "./api-probes";
import { GET, POST } from "./constants";
import { OWNER, type ReqCtx, type Route, route } from "./core";
import { fail, json, readJson } from "./http";

const ERR_OWNER = "只有主账号能配对主机";
const ERR_SUBJECT = "需要 subject";
const ERR_NO_HOST = "主机不在线或没有开启 Agent";
const ERR_TIMEOUT = "主机没有回应, 稍后再试";

type Body = Record<string, unknown> | undefined;

// 配对: 主账号复核密码 -> 设备公钥经探针长连转给主机 -> 等主机回 ag_paired (10 秒)
async function pair(c: ReqCtx): Promise<Response> {
  const b = (await readJson(c.req)) as Body;
  const subject = typeof b?.subject === "string" ? b.subject.trim() : "";
  const device = parseAgPairDevice(b?.device);
  const denied = await ownerPassword(c, b?.password, ERR_OWNER);
  if (denied) return denied;
  if (!subject) return fail(400, ERR_SUBJECT);
  if (typeof device === "string") return fail(400, device);
  if (!c.core.agentGui.probeFor(subject)) return fail(409, ERR_NO_HOST);
  const r = await c.core.agentGui.pair(subject, device);
  if (!r) return fail(504, ERR_TIMEOUT);
  if (!r.ok) return fail(409, r.err);
  const out: AgPairResponse = { host: subject, pub: r.pub, routes: r.routes, device: r.device };
  return json(out);
}

// 离线回来补拉: 没答的卡片 (按收到时间升序) 与主机列表
function inbox(c: ReqCtx): Response {
  const out: AgInboxResponse = { cards: c.core.agentGui.store.open(), hosts: c.core.agentGui.hosts() };
  return json(out);
}

export const AGENT_GUI_ROUTES: Route[] = [route(POST, PATH_AGENT_GUI_PAIR, OWNER, pair), route(GET, PATH_AGENT_GUI_INBOX, OWNER, inbox)];
