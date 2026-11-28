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
export type AgHost = { subject: string; online: boolean; routes: AgRoute[]; sessions: AgIndexItem[] };
// 探针在 host info 里声明 (AIOA_AGENT=1 时)
export type AgHostInfo = { port: number; v: number; routes: AgRoute[] };

// ---- 直连 (浏览器 <-> 探针 WS), 探针与 Web 各自实现, 这里只给类型 ----
export type AgHello = { v: number; host: string; pub: JsonWebKey; nonce: string; agent: "hx-aioa-agent" };
export type AgDirectChallenge = { t: "challenge"; nonce: string; host: string; pub: JsonWebKey };
export type AgDirectHello = { t: "hello"; device: string; sig: string; fg?: boolean };
export type AgDirectReady = { t: "ready"; device: string; host: string; sessions: AgSessionInfo[]; instances: AgInstance[]; settings: AgSettings };
export type AgDirectError = { t: "error"; code: string; msg: string };
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
] as const;
export type AgHxMethod = (typeof AG_HX_METHODS)[number];
export type AgGitFile = { path: string; x: string; y: string; add: number; del: number };
export type AgFsEntry = { name: string; dir: boolean; size: number };

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
export type AgHostsFrame = { t: "ag_hosts"; hosts: AgHost[] };
export type AgUnreqFrame = { t: "ag_unreq"; host: string; sid: string; rid: string; by: AgUnreqBy };
export type AgAnswerFrame = { t: "ag_answer"; aid: string; host: string; sid: string; rid: string; option: string | null; text: string };
// 探针 / 客户端 -> Hub (Hub 再按连接角色分别认)
export type AgInFrame = AgIndexFrame | AgReqFrame | AgProbeUnreqFrame | AgPairedFrame | AgAnswerFrame;
export type AgOutFrame = AgPairFrame | AgProbeAnswerFrame | AgHostsFrame | AgReqFrame | AgUnreqFrame;
export type AgInboxResponse = { cards: AgCard[]; hosts: AgHost[] };
export type AgPairRequest = { subject: string; password: string; device: AgPairDevice };
export type AgPairResponse = { host: string; pub: AgPublicJwk; routes: AgRoute[]; device: AgDevice };

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

export function parseAgHostInfo(v: unknown): AgHostInfo | null {
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
