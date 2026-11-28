// Agent GUI (#126): 浏览器直连探针 (ACP 原样) 与经 Hub 的少量帧 (会话索引, 审批, 配对), 契约见 docs/design/agent-gui-impl.md
export const PATH_AGENT_GUI = "/api/agent-gui";
export const PATH_AGENT_GUI_PAIR = `${PATH_AGENT_GUI}/pair`;
export const PATH_AGENT_GUI_INBOX = `${PATH_AGENT_GUI}/inbox`;
export const AG_PROTOCOL_V = 1;
export const AG_DEFAULT_PORT = 7841;
export const AG_PAIR_TIMEOUT_MS = 10_000;
// 待审批卡片: 答复 / 撤回后 24 小时清理, 一直没人答的 7 天清理
export const AG_DONE_TTL_MS = 24 * 3600_000;
export const AG_OPEN_TTL_MS = 7 * 24 * 3600_000;
// 静默推送后多久探针以 quiet:false 重发
export const AG_QUIET_REPUSH_SEC = 60;
// ag_index 合并: 最后一次变化后再等这么久才发 (trailing), 一直在变也最迟这么久发一次
export const AG_INDEX_MERGE_MS = 5000;
export const AG_INDEX_MAX_WAIT_MS = 20_000;
// 会话索引里的上下文占比只报分档 (档下限), 跨档才触发上报: <50% 报 0, 其余报 0.5 / 0.8 / 0.95
export const AG_CTX_BANDS = [0.5, 0.8, 0.95] as const;
// Hub 转出 ag_answer 后等探针 ag_ack 的时长 (只在内存, 超时丢弃)
export const AG_ACK_TIMEOUT_MS = 30_000;

export const AG_MAX_ID = 128;
export const AG_MAX_TITLE = 300;
export const AG_MAX_PATH = 1024;
export const AG_MAX_TOOL_CONTENT = 2048;
export const AG_MAX_TEXT = 1000;
export const AG_MAX_ANSWER_TEXT = 4000;
export const AG_MAX_WHY = 8;
export const AG_MAX_OPTIONS = 8;
export const AG_MAX_LOCATIONS = 20;
export const AG_MAX_SESSIONS = 200;
// 路线也进探针连接的 attachment (主机卡片), 条数与长度都要小
export const AG_MAX_ROUTES = 4;
export const AG_MAX_URL = 120;
const MAX_SHORT = 64;
const MAX_JWK_PART = 128;

export const AG_ROUTE_KINDS = ["local", "lan", "tunnel"] as const;
export type AgRouteKind = (typeof AG_ROUTE_KINDS)[number];
export const AG_SESSION_STATES = ["starting", "running", "waiting", "idle", "error", "closed"] as const;
export type AgSessionState = (typeof AG_SESSION_STATES)[number];
export const AG_INSTANCE_KINDS = ["claude", "codex", "dsh", "custom"] as const;
export type AgInstanceKind = (typeof AG_INSTANCE_KINDS)[number];
export const AG_RISKS = ["low", "mid", "high"] as const;
export type AgRisk = (typeof AG_RISKS)[number];
export const AG_WATCH_PUSH = ["quiet", "none", "normal"] as const;
export type AgWatchPush = (typeof AG_WATCH_PUSH)[number];
// 探针报的撤回来源 / Hub 广播给客户端的撤回来源
export const AG_PROBE_BY = ["desktop", "agent"] as const;
export type AgProbeBy = (typeof AG_PROBE_BY)[number];
export const AG_UNREQ_BY = ["desktop", "phone", "web", "agent"] as const;
export type AgUnreqBy = (typeof AG_UNREQ_BY)[number];
// 探针对 Hub 转来的答复的确认: hub = 这次答复生效; 其余 = 已被别处答了 / Agent 取消了, 以它为准
export const AG_ACK_BY = ["hub", "desktop", "agent"] as const;
export type AgAckBy = (typeof AG_ACK_BY)[number];
// 主机声明了 agent 但 Hub 不放行的原因: scope = key 缺 probe:agent
export const AG_DENIED = ["scope"] as const;
export type AgDenied = (typeof AG_DENIED)[number];
export const AG_SCOPE = "probe:agent";

export type AgRoute = { kind: AgRouteKind; url: string };
export type AgPublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };
export type AgInstance = { id: string; name: string; kind: AgInstanceKind; cmd: string; args: string[]; env?: Record<string, string>; model?: string; mode?: string };
export type AgSessionInfo = {
  id: string;
  instance: string;
  agent: string;
  title: string;
  cwd: string;
  state: AgSessionState;
  created: number;
  updated: number;
  ctx?: number;
  pending: number;
  adds?: number;
  dels?: number;
  err?: string;
  modes?: unknown;
  models?: unknown;
  caps?: unknown;
};
export type AgSettings = { watchPush: AgWatchPush; quietRepushSec: number };
export type AgDevice = { id: string; name: string; pub: JsonWebKey; added: number; last?: number };
export type AgPermOption = { optionId: string; kind: string; name: string };
export type AgCard = {
  rid: string;
  sid: string;
  host: string;
  agent: string;
  title: string;
  cwd: string;
  branch?: string;
  at: number;
  tool: { kind: string; title: string; content: string; locations: string[] };
  goal: string;
  last: string;
  risk: AgRisk;
  why: string[];
  changed: number;
  options: AgPermOption[];
  quiet?: boolean;
};
// Hub 里的会话索引 (只放内存)
export type AgIndexItem = { id: string; agent: string; title: string; state: AgSessionState; ctx?: number; pending: number; updated: number };
// denied: 主机本地开了 Agent 但 key 缺 probe:agent, 此时 routes / sessions 为空 (Web 显示 "开启" 按钮, 调 PATH_PROBE_SCOPE)
export type AgHost = { subject: string; online: boolean; routes: AgRoute[]; sessions: AgIndexItem[]; denied?: AgDenied };
// 探针在 host info 里声明 (AIOA_AGENT=1 时); denied 只由 Hub 写 (探针报的会被丢掉), 写了 denied 时 routes 为空
export type AgHostInfo = { port: number; v: number; routes: AgRoute[]; denied?: AgDenied };

/** 上下文占比 -> 分档下限 (0 / 0.5 / 0.8 / 0.95); 没有占比返回 undefined。 */
export function agCtxBand(ctx: number | undefined): number | undefined {
  if (typeof ctx !== "number" || !Number.isFinite(ctx)) return undefined;
  let band = 0;
  for (const b of AG_CTX_BANDS) if (ctx >= b) band = b;
  return band;
}

// ---- 直连 (浏览器 <-> 探针 WS), 探针与 Web 各自实现, 这里只给类型 ----
export type AgHello = { v: number; host: string; pub: JsonWebKey; nonce: string; agent: "hx-aioa-agent" };
export type AgDirectChallenge = { t: "challenge"; nonce: string; host: string; pub: JsonWebKey };
export type AgDirectHello = { t: "hello"; device: string; sig: string; fg?: boolean };
export type AgDirectReady = { t: "ready"; device: string; host: string; sessions: AgSessionInfo[]; instances: AgInstance[]; settings: AgSettings };
// code=auth_required: session/create 或 session/resume 时 Agent 要求先登录; methods 是 initialize 回的 authMethods 原样,
// instance 是要登录的实例, id 是触发它的 hx 请求 id; 选一个 methodId 调 hx agent/authenticate
export type AgAuthMethod = { id: string; name: string; description?: string | null; [k: string]: unknown };
export type AgDirectError = { t: "error"; code: string; msg: string; methods?: AgAuthMethod[]; instance?: string; sid?: string; id?: number };
export const AG_ERR_AUTH_REQUIRED = "auth_required";
export type AgAttach = { t: "attach"; sid: string; since?: number };
export type AgDetach = { t: "detach"; sid: string };
export type AgFg = { t: "fg"; on: boolean };
export type AgAcpOut = { t: "acp_out"; sid: string; m: unknown };
export type AgPerm = { t: "perm"; sid: string; rid: string; option: string | null; text?: string };
export type AgHx = { t: "hx"; id: number; m: AgHxMethod; p: unknown };
export type AgDirectClientFrame = AgDirectHello | AgAttach | AgDetach | AgFg | AgAcpOut | AgPerm | AgHx;
export type AgAcp = { t: "acp"; sid: string; seq: number; m: unknown };
export type AgWindow = { t: "window"; sid: string; from: number; to: number; more: boolean; items: { seq: number; m: unknown }[] };
export type AgPermReq = { t: "perm_req"; sid: string; rid: string; card: AgCard };
export type AgPermDone = { t: "perm_done"; sid: string; rid: string; by: "desktop" | "hub" | "agent"; option?: string };
export type AgSessionFrame = { t: "session"; info: AgSessionInfo };
export type AgStats = { t: "stats"; sid: string; ctx?: [number, number]; tps?: number; est?: boolean; hit?: number; cost?: number; in?: number; out?: number; cr?: number; cw?: number; ms?: number };
export type AgHxRes = { t: "hx_res"; id: number; ok: true; r: unknown } | { t: "hx_res"; id: number; ok: false; err: string };
export type AgDirectServerFrame = AgDirectChallenge | AgDirectReady | AgDirectError | AgAcp | AgWindow | AgPermReq | AgPermDone | AgSessionFrame | AgStats | AgHxRes;
export const AG_HX_METHODS = [
  "session/create",
  "session/close",
  "session/delete",
  "session/rename",
  "session/resume",
  "log/page",
  "instances/list",
  "instances/save",
  "instances/delete",
  "settings/get",
  "settings/set",
  "devices/list",
  "devices/remove",
  "git/status",
  "git/diff",
  "fs/tree",
  "fs/read",
  "tool/output",
  "dirs/recent",
  "agent/authenticate",
] as const;
export type AgHxMethod = (typeof AG_HX_METHODS)[number];
export type AgGitFile = { path: string; x: string; y: string; add: number; del: number };
export type AgFsEntry = { name: string; dir: boolean; size: number };
// hx agent/authenticate: 在等登录的那个 Agent 进程上调 ACP authenticate, 成功后重试原来的 session/new (或恢复)
export type AgAuthenticateParams = { instance: string; methodId: string };
// 有等登录的会话: 返回重试后的 SessionInfo; 没有: 起临时进程登录后退出, 返回 { authenticated: true } (客户端再 session/create)
export type AgAuthenticateResult = AgSessionInfo | { authenticated: true };

// ---- 经 Hub (现有长连帧) ----
export type AgPairDevice = { id: string; name: string; pub: AgPublicJwk };
export type AgIndexFrame = { t: "ag_index"; sessions: AgIndexItem[] };
export type AgReqFrame = { t: "ag_req"; card: AgCard };
export type AgProbeUnreqFrame = { t: "ag_unreq"; sid: string; rid: string; by: AgProbeBy };
export type AgPairedFrame =
  | { t: "ag_paired"; pid: string; ok: true; device: AgDevice; pub: AgPublicJwk; routes: AgRoute[] }
  | { t: "ag_paired"; pid: string; ok: false; err: string };
export type AgPairFrame = { t: "ag_pair"; pid: string; device: AgPairDevice };
export type AgProbeAnswerFrame = { t: "ag_answer"; aid: string; sid: string; rid: string; option: string | null; text: string };
// Hub -> 探针: DO 休眠醒来内存索引为空, 请探针立刻重报 ag_index
export type AgReindexFrame = { t: "ag_reindex" };
// 探针 -> Hub: 对每个 ag_answer 的确认; by=hub 表示这次答复生效, 否则以 by 为准 (Hub 改正并回告答题端)
export type AgAckFrame = { t: "ag_ack"; aid: string; sid: string; rid: string; by: AgAckBy; option?: string | null };
// Hub -> 答题的客户端: 探针确认后回告; ok=false 表示答晚了, 实际由 by 答复 / 撤回, 这一端的选择没有生效
export type AgAnsweredFrame = { t: "ag_answered"; aid: string; host: string; sid: string; rid: string; ok: boolean; by: AgUnreqBy };
export type AgHostsFrame = { t: "ag_hosts"; hosts: AgHost[] };
export type AgUnreqFrame = { t: "ag_unreq"; host: string; sid: string; rid: string; by: AgUnreqBy };
export type AgAnswerFrame = { t: "ag_answer"; aid: string; host: string; sid: string; rid: string; option: string | null; text: string };
// 探针 / 客户端 -> Hub (Hub 再按连接角色分别认)
export type AgInFrame = AgIndexFrame | AgReqFrame | AgProbeUnreqFrame | AgPairedFrame | AgAnswerFrame | AgAckFrame;
export type AgOutFrame = AgPairFrame | AgProbeAnswerFrame | AgReindexFrame | AgHostsFrame | AgReqFrame | AgUnreqFrame | AgAnsweredFrame;
export type AgInboxResponse = { cards: AgCard[]; hosts: AgHost[] };
export type AgPairRequest = { subject: string; password: string; device: AgPairDevice };
export type AgPairResponse = { host: string; pub: AgPublicJwk; routes: AgRoute[]; device: AgDevice };
// POST PATH_PROBE_SCOPE (主账号): 给主机的 key 补 scope; key 不变 (scope 存在服务端), 探针被断开后自动重连生效, 所以 key 总是不给
export type ProbeScopeRequest = { add: "probe:agent"[] };
export type ProbeScopeResponse = { ok: true; key?: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= AG_MAX_ID;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
// 展示用文本: 超长截断, 不整帧拒绝
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const texts = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, n).map((x: string) => x.slice(0, max)) : []);

/** 只留 P-256 公钥四项; 带私钥 d 或别的曲线一律拒。 */
export function parseAgJwk(v: unknown): AgPublicJwk | null {
  if (!isObj(v) || v.kty !== "EC" || v.crv !== "P-256" || "d" in v) return null;
  const ok = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= MAX_JWK_PART && /^[A-Za-z0-9_-]+$/.test(s);
  return ok(v.x) && ok(v.y) ? { kty: "EC", crv: "P-256", x: v.x, y: v.y } : null;
}

export function parseAgRoutes(v: unknown): AgRoute[] | null {
  if (!Array.isArray(v) || v.length > AG_MAX_ROUTES) return null;
  const out: AgRoute[] = [];
  for (const r of v) {
    if (!isObj(r) || !oneOf(AG_ROUTE_KINDS, r.kind) || typeof r.url !== "string" || r.url.length > AG_MAX_URL || !/^https?:\/\/[^\s/]+/.test(r.url)) return null;
    out.push({ kind: r.kind, url: r.url });
  }
  return out;
}

/** host info 的 agent 声明; 带 denied (Hub 下发的 "key 缺 probe:agent") 时放行, port / v 缺省为 0, 路线清空。 */
export function parseAgHostInfo(v: unknown): AgHostInfo | null {
  if (isObj(v) && oneOf(AG_DENIED, v.denied)) {
    const port = isNum(v.port) && Number.isInteger(v.port) && v.port > 0 && v.port <= 65535 ? v.port : 0;
    return { port, v: isNum(v.v) ? v.v : 0, routes: [], denied: v.denied };
  }
  if (!isObj(v) || !isNum(v.port) || !Number.isInteger(v.port) || v.port <= 0 || v.port > 65535 || !isNum(v.v)) return null;
  const routes = v.routes === undefined ? [] : parseAgRoutes(v.routes);
  return routes ? { port: v.port, v: v.v, routes } : null;
}

export function parseAgCard(v: unknown): AgCard | null {
  if (!isObj(v) || !isId(v.rid) || !isId(v.sid) || !isNum(v.at) || !oneOf(AG_RISKS, v.risk) || !isObj(v.tool)) return null;
  if (!Array.isArray(v.options) || v.options.length > AG_MAX_OPTIONS) return null;
  const options: AgPermOption[] = [];
  for (const o of v.options) {
    if (!isObj(o) || !isId(o.optionId)) return null;
    options.push({ optionId: o.optionId, kind: text(o.kind, MAX_SHORT), name: text(o.name, AG_MAX_ID) });
  }
  const t = v.tool;
  const card: AgCard = {
    rid: v.rid,
    sid: v.sid,
    host: text(v.host, AG_MAX_ID),
    agent: text(v.agent, MAX_SHORT),
    title: text(v.title, AG_MAX_TITLE),
    cwd: text(v.cwd, AG_MAX_PATH),
    at: v.at,
    tool: { kind: text(t.kind, MAX_SHORT), title: text(t.title, AG_MAX_TITLE), content: text(t.content, AG_MAX_TOOL_CONTENT), locations: texts(t.locations, AG_MAX_LOCATIONS, AG_MAX_PATH) },
    goal: text(v.goal, AG_MAX_TEXT),
    last: text(v.last, AG_MAX_TEXT),
    risk: v.risk,
    why: texts(v.why, AG_MAX_WHY, AG_MAX_TITLE),
    changed: isNum(v.changed) && v.changed >= 0 ? Math.floor(v.changed) : 0,
    options,
  };
  if (typeof v.branch === "string" && v.branch) card.branch = v.branch.slice(0, AG_MAX_TITLE);
  if (v.quiet === true) card.quiet = true;
  return card;
}

function parseIndexItem(v: unknown): AgIndexItem | null {
  if (!isObj(v) || !isId(v.id) || !oneOf(AG_SESSION_STATES, v.state)) return null;
  const item: AgIndexItem = { id: v.id, agent: text(v.agent, MAX_SHORT), title: text(v.title, AG_MAX_TITLE), state: v.state, pending: isNum(v.pending) && v.pending >= 0 ? Math.floor(v.pending) : 0, updated: isNum(v.updated) ? v.updated : 0 };
  if (isNum(v.ctx) && v.ctx >= 0 && v.ctx <= 1) item.ctx = v.ctx;
  return item;
}

function parseDevice(v: unknown): AgDevice | null {
  if (!isObj(v) || !isId(v.id)) return null;
  const pub = parseAgJwk(v.pub);
  if (!pub) return null;
  const d: AgDevice = { id: v.id, name: text(v.name, MAX_SHORT), pub, added: isNum(v.added) ? v.added : 0 };
  if (isNum(v.last)) d.last = v.last;
  return d;
}

/** 配对时客户端报的设备: id, 名字, 公钥。 */
export function parseAgPairDevice(v: unknown): AgPairDevice | string {
  if (!isObj(v) || !isId(v.id)) return "device.id 无效";
  const pub = parseAgJwk(v.pub);
  if (!pub) return "device.pub 必须是 P-256 公钥 JWK";
  const name = text(v.name, MAX_SHORT).trim();
  return { id: v.id, name: name || v.id, pub };
}

const optionOf = (v: unknown): string | null | undefined => (v === null ? null : isId(v) ? v : undefined);

/** 探针或客户端发给 Hub 的 ag_* 帧; 不认识或不合法返回 null。 */
export function parseAgFrame(f: Record<string, unknown>): AgInFrame | null {
  switch (f.t) {
    case "ag_index": {
      if (!Array.isArray(f.sessions) || f.sessions.length > AG_MAX_SESSIONS) return null;
      const sessions = f.sessions.map(parseIndexItem);
      return sessions.every((s) => s) ? { t: "ag_index", sessions: sessions as AgIndexItem[] } : null;
    }
    case "ag_req": {
      const card = parseAgCard(f.card);
      return card ? { t: "ag_req", card } : null;
    }
    case "ag_unreq":
      return isId(f.sid) && isId(f.rid) && oneOf(AG_PROBE_BY, f.by) ? { t: "ag_unreq", sid: f.sid, rid: f.rid, by: f.by } : null;
    case "ag_paired": {
      if (!isId(f.pid)) return null;
      if (f.ok !== true) return { t: "ag_paired", pid: f.pid, ok: false, err: text(f.err, AG_MAX_TITLE) || "主机拒绝配对" };
      const device = parseDevice(f.device);
      const pub = parseAgJwk(f.pub);
      const routes = parseAgRoutes(f.routes ?? []);
      return device && pub && routes ? { t: "ag_paired", pid: f.pid, ok: true, device, pub, routes } : null;
    }
    case "ag_ack": {
      if (!isId(f.aid) || !isId(f.sid) || !isId(f.rid) || !oneOf(AG_ACK_BY, f.by)) return null;
      const out: AgAckFrame = { t: "ag_ack", aid: f.aid, sid: f.sid, rid: f.rid, by: f.by };
      const option = optionOf(f.option);
      if (option !== undefined) out.option = option;
      return out;
    }
    case "ag_answer": {
      const option = optionOf(f.option);
      if (!isId(f.aid) || !isId(f.host) || !isId(f.sid) || !isId(f.rid) || option === undefined) return null;
      if (f.text !== undefined && (typeof f.text !== "string" || f.text.length > AG_MAX_ANSWER_TEXT)) return null;
      return { t: "ag_answer", aid: f.aid, host: f.host, sid: f.sid, rid: f.rid, option, text: typeof f.text === "string" ? f.text : "" };
    }
    default:
      return null;
  }
}
