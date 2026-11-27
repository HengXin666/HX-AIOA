import {
  MAX_AGENT_READS,
  MAX_AVATAR_BYTES,
  MAX_CHAT_AGENTS,
  MAX_ID_LENGTH,
  MAX_TITLE_LENGTH,
  PATH_AVATAR,
  PATH_AVATARS,
  PATH_CHAT_AGENT,
  PATH_AGENT_GUIDE,
  PATH_AGENT_GUIDE_ACK,
  PATH_CHAT_AGENT_PROMPT,
  HEADER_GUIDE_VERSION,
  PATH_CHAT_AGENT_ROTATE,
  PATH_CHAT_AGENTS,
  PATH_CHAT_MESSAGES,
  PATH_EVENT_BY_SEQ,
  PATH_FAVORITE,
  PATH_FAVORITES,
  QUERY_BEFORE,
  QUERY_SLIM,
  QUERY_LIMIT,
  QUERY_SINCE,
  dmPeers,
  globMatch,
  type AgentJob,
  MAX_AGENT_TASK,
  type ChatAgent,
  type ChatCleared,
  type ChatMeta,
  type Envelope,
  type ChatSyncFrame,
  type OnboardResult,
  type Scope,
} from "@hx-aioa/protocol";
import { dropAgentAlias } from "./agent-name";
import { agentSetup } from "./agent-prompt";
import { acked, guideFor } from "./agent-sync";
import { CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_DM, ERR_FORBIDDEN, ERR_NO_RESOURCE, GET, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT, PATCH, POST, PUT } from "./constants";
import { type Core, OWNER, type Principal, ROOM, type ReqCtx, type Route, route } from "./core";
import { roleIn } from "./room-access";
import { autoUpgrade } from "./plugins/update";
import { notePoll, touchAgent } from "./api-presence";
import { ApiFail, clampInt, etagged, fail, json, readJson } from "./http";
import { syncChat } from "./chat-sync";

const AGENT_SCOPES: Scope[] = ["messages:send", "events:write"];
const READ_SCOPE: Scope = "events:read";
const AVATAR_ID_HEX = 24;
const IMMUTABLE = "public, max-age=31536000, immutable";
const IMAGE_PREFIX = "image/";

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
// 线上一律给 https 地址, 本地调试保持原样
export const baseOf = (u: URL) => (LOCAL_HOSTS.includes(u.hostname) ? u.origin : `https://${u.host}`);
const param = (c: ReqCtx, i: number) => decodeURIComponent(c.params[i] ?? "");
const notFound = () => fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 收藏只是主人的
function syncFavorites(core: Core): void {
  core.sockets.toV1Clients({ t: "chat_sync", topic: "favorites" } satisfies ChatSyncFrame);
}

export function canRead(core: Core, who: Principal, channel: string): boolean {
  if (who.owner) return true;
  if (who.member) return roleIn(core, who, channel) !== null;
  return who.key.scopes.includes(READ_SCOPE) && who.key.channels.some((p) => globMatch(p, channel));
}

// 去掉 HTML 卡片, 只留长度, 其余原样
function slimmed(ev: Envelope): Envelope {
  const d = ev.data as Record<string, unknown> | undefined;
  if (typeof d?.html !== "string") return ev;
  const { html, ...rest } = d;
  return { ...ev, data: { ...rest, htmlBytes: html.length } } as unknown as Envelope;
}

function chatMessages(c: ReqCtx): Response {
  const channel = param(c, 0);
  if (!canRead(c.core, c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const slim = c.url.searchParams.get(QUERY_SLIM) === "1";
  const out = (list: Envelope[]) => (slim ? list.map(slimmed) : list);
  const limit = clampInt(c.url.searchParams.get(QUERY_LIMIT), HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
  // before: 向前翻页, 群键与客户端一致 (没写 channel 的按来源名, 本机发出的归备忘)
  const before = c.url.searchParams.get(QUERY_BEFORE);
  if (before !== null) {
    const messages = c.core.store.groupBefore(channel, clampInt(before, 1, Number.MAX_SAFE_INTEGER), limit);
    return json({ messages: out(messages), head: c.core.store.head() });
  }
  const since = clampInt(c.url.searchParams.get(QUERY_SINCE), 0, Number.MAX_SAFE_INTEGER);
  notePoll(c.core, c.who, channel);
  const messages = c.core.store.inChannel(channel, since, limit);
  return json({ messages: out(messages), head: messages.at(-1)?.seq ?? since });
}

// 清空聊天记录: 删服务端存档, 并把位置记进群资料, 各端据此删本地
async function clearChat(c: ReqCtx): Promise<Response> {
  const channel = param(c, 0);
  if (!channel || channel.length > MAX_ID_LENGTH) return fail(400, "群名不合法");
  const head = c.core.store.head();
  const before = clampInt(c.url.searchParams.get(QUERY_BEFORE), head + 1, head + 1);
  const deleted = c.core.store.clearGroup(channel, before);
  await c.core.files.dropGroup(channel);
  const meta = c.core.chats.patchChat(channel, {});
  const cleared = Math.max(meta.cleared ?? 0, before - 1);
  c.core.chats.replaceChat({ ...meta, cleared });
  syncChat(c.core, channel);
  return json({ deleted, cleared } satisfies ChatCleared);
}

type AgentInput = { name: string; reads: string[]; job?: AgentJob; autoMajor?: boolean };
const SEND_SCOPE: Scope = "messages:send";
const MARKDOWN = "text/markdown; charset=utf-8";

function parseAgent(raw: unknown, partial: boolean): Partial<AgentInput> | string {
  if (!isObj(raw)) return "需要 JSON 对象";
  const out: Partial<AgentInput> = {};
  if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name.trim().slice(0, MAX_TITLE_LENGTH);
  else if (!partial) return "需要 name";
  if (raw.reads !== undefined) {
    if (!Array.isArray(raw.reads) || raw.reads.length > MAX_AGENT_READS || !raw.reads.every((x) => typeof x === "string" && x)) return "reads 必须是群名数组";
    out.reads = [...new Set(raw.reads as string[])];
  }
  // 接入向导第二步: 定时与任务只进这次的接入语
  const interval = typeof raw.interval === "number" && raw.interval >= 10 ? Math.round(raw.interval) : undefined;
  const task = typeof raw.task === "string" && raw.task.trim() ? raw.task.trim().slice(0, MAX_AGENT_TASK) : undefined;
  if (interval || task) out.job = { ...(interval ? { interval } : {}), ...(task ? { task } : {}) };
  if (typeof raw.autoMajor === "boolean") out.autoMajor = raw.autoMajor;
  return out;
}

function agentOf(meta: ChatMeta | null, keyId: string): ChatAgent {
  const a = meta?.agents?.find((x) => x.keyId === keyId);
  if (!a) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_RESOURCE);
  return a;
}

export function saveAgents(core: Core, channel: string, agents: ChatAgent[]): ChatMeta {
  const meta = core.chats.patchChat(channel, {});
  const next = { ...meta, agents };
  core.chats.replaceChat(next);
  // Agent 只在主人视图里, 子号不必知道
  syncChat(core, channel, { ownerOnly: true });
  return next;
}

// 新 key: 写本群 (来源默认 channel 就是本群), 读 reads 里的群
async function issueKey(core: Core, channel: string, a: Pick<ChatAgent, "name" | "sourceId" | "reads">) {
  const reads = a.reads.filter((r) => r !== channel);
  const scopes = reads.length || a.reads.includes(channel) ? [...AGENT_SCOPES, READ_SCOPE] : [...AGENT_SCOPES];
  return core.registry.createKey({ name: a.name, scopes, channels: [channel, ...reads], sourceId: a.sourceId });
}

function titleOf(core: Core, channel: string): string {
  return core.chats.chat(channel)?.title || channel;
}

// 新建接入: 来源 + key + 群资料里的一项; 插件安装也走这里
export async function createAgent(core: Core, channel: string, name: string, reads: string[], plugin?: string): Promise<{ agent: ChatAgent; key: string }> {
  const src = core.registry.createSource({ name, type: "agent", channel });
  const draft = { name, sourceId: src.id, reads };
  const { info, key } = await issueKey(core, channel, draft);
  src.keyId = info.id;
  core.registry.saveSource(src);
  const agent: ChatAgent = { ...draft, keyId: info.id, created: Date.now(), pending: true, setup: 1, ...(plugin ? { plugin } : {}) };
  saveAgents(core, channel, [...(core.chats.chat(channel)?.agents ?? []), agent]);
  return { agent, key };
}

export function dropAgent(core: Core, channel: string, keyId: string): void {
  const meta = core.chats.chat(channel);
  const old = agentOf(meta, keyId);
  core.registry.deleteSource(old.sourceId);
  core.registry.deleteKey(old.keyId);
  saveAgents(core, channel, (meta?.agents ?? []).filter((x) => x.keyId !== old.keyId));
}

async function addAgent(c: ReqCtx): Promise<Response> {
  const channel = param(c, 0);
  if (dmPeers(channel)) return fail(400, `${ERR_DM}接入 Agent`);
  const p = parseAgent(await readJson(c.req), false);
  if (typeof p === "string") return fail(400, p);
  if ((c.core.chats.chat(channel)?.agents ?? []).length >= MAX_CHAT_AGENTS) return fail(400, `每个群最多 ${MAX_CHAT_AGENTS} 个 Agent`);
  const { agent, key } = await createAgent(c.core, channel, p.name!, p.reads ?? []);
  const prompt = agentSetup(baseOf(c.url), { title: titleOf(c.core, channel), channel, setup: 1, interval: p.job?.interval, task: p.job?.task, key });
  return json({ agent, prompt, key } satisfies OnboardResult);
}

// 重新接入: 作废旧 key, 发新 key, 来源与历史消息不变
async function rotateAgent(c: ReqCtx): Promise<Response> {
  const channel = param(c, 0);
  const meta = c.core.chats.chat(channel);
  const old = agentOf(meta, param(c, 1));
  c.core.registry.deleteKey(old.keyId);
  const { info, key } = await issueKey(c.core, channel, old);
  const src = c.core.registry.source(old.sourceId);
  if (src) c.core.registry.saveSource({ ...src, keyId: info.id });
  const { brief: _b, ...rest } = old;
  const agent: ChatAgent = { ...rest, keyId: info.id, rotated: Date.now(), pending: true, setup: old.setup ?? 1 };
  saveAgents(c.core, channel, (meta?.agents ?? []).map((x) => (x.keyId === old.keyId ? agent : x)));
  if (agent.plugin) {
    // 插件记录跟着换 keyId, 否则卸载时找不到这个 Agent
    const rec = c.core.plugins.get(agent.plugin);
    if (rec?.keyId === old.keyId) c.core.plugins.setInstall({ ...rec, keyId: info.id });
  }
  return json({ agent, prompt: setupPrompt(c, channel, agent, key), key } satisfies OnboardResult);
}

async function patchAgent(c: ReqCtx): Promise<Response> {
  const channel = param(c, 0);
  const meta = c.core.chats.chat(channel);
  const old = agentOf(meta, param(c, 1));
  const p = parseAgent(await readJson(c.req), true);
  if (typeof p === "string") return fail(400, p);
  const base = baseOf(c.url);
  const { job: _j, ...picked } = p;
  const agent: ChatAgent = { ...old, ...picked };
  // 大更新自动执行的授权写在接入语里, 拨动开关就要重发接入语
  if (p.autoMajor !== undefined && p.autoMajor !== !!old.autoMajor) agent.setup = (old.setup ?? 1) + 1;
  // 指令内容变了, 等它下次拉取后重新报到
  if (guideFor(c.core, base, channel, agent).version !== guideFor(c.core, base, channel, old).version) agent.pending = true;
  // 读权限变了就改 key 的白名单与 scope, key 本身不变
  const key = c.core.registry.key(old.keyId);
  if (key && p.reads) {
    const reads = agent.reads.filter((r) => r !== channel);
    const scopes = agent.reads.length ? [...AGENT_SCOPES, READ_SCOPE] : [...AGENT_SCOPES];
    c.core.registry.saveKey({ ...key, name: agent.name, channels: [channel, ...reads], scopes });
  }
  const src = c.core.registry.source(old.sourceId);
  if (src && p.name) c.core.registry.saveSource({ ...src, name: p.name });
  saveAgents(c.core, channel, (meta?.agents ?? []).map((x) => (x.keyId === old.keyId ? agent : x)));
  if (p.name && old.sourceId) dropAgentAlias(c.core, old.sourceId, p.name);
  return json({ agent });
}

function removeAgent(c: ReqCtx): Response {
  dropAgent(c.core, param(c, 0), param(c, 1));
  return json({ ok: true });
}

// 接入语: 给 key 时是新接入, 不给时是更新用 (不含密钥)
function setupPrompt(c: ReqCtx, channel: string, agent: ChatAgent, key?: string): string {
  const job = agent.plugin ? c.core.plugins.job(agent.plugin) : undefined;
  return agentSetup(baseOf(c.url), { title: titleOf(c.core, channel), channel, setup: agent.setup ?? 1, auto: agent.autoMajor, interval: job?.interval, ...(key ? { key } : {}) });
}

// skill 版 Agent (有接入版本或上报过 skill) 给更新用接入语, 老 Agent 仍给专属指令
function agentPromptOf(c: ReqCtx): Response {
  const channel = param(c, 0);
  const agent = agentOf(c.core.chats.chat(channel), param(c, 1));
  const prompt = agent.setup || agent.skills ? setupPrompt(c, channel, agent) : guideFor(c.core, baseOf(c.url), channel, agent).text;
  return json({ agent, prompt });
}

// 按 key 找到它所在的群和 Agent 资料
export function agentByKey(c: ReqCtx): { channel: string; meta: ChatMeta; agent: ChatAgent } {
  const hit = c.who.owner ? null : c.core.chats.byKey(c.who.key.id);
  if (hit) return { channel: hit.meta.channel, meta: hit.meta, agent: hit.agent };
  throw new ApiFail(403, CODE_FORBIDDEN, "这把密钥不是群里接入的 Agent");
}

async function agentGuideOf(c: ReqCtx): Promise<Response> {
  const { channel, agent } = agentByKey(c);
  touchAgent(c.core, agent.keyId);
  // 插件 Agent 拉指令时顺手做自动更新, 新版提示词当场生效
  if (agent.plugin) await autoUpgrade(c.core, agent.plugin);
  const g = guideFor(c.core, baseOf(c.url), channel, agent);
  return new Response(g.text, { headers: { "Content-Type": MARKDOWN, [HEADER_GUIDE_VERSION]: g.version } });
}

async function agentAck(c: ReqCtx): Promise<Response> {
  const { channel, meta, agent } = agentByKey(c);
  const raw = await readJson(c.req);
  const g = guideFor(c.core, baseOf(c.url), channel, agent);
  if (!isObj(raw) || raw.version !== g.version) return fail(409, `指令已更新到 ${g.version}, 请重新 GET ${PATH_AGENT_GUIDE}`);
  await acked(c.core, c.req, meta, agent, g.version);
  return json({ ok: true, version: g.version });
}

function seqParam(c: ReqCtx): number {
  const n = Number.parseInt(param(c, 0), 10);
  if (!Number.isFinite(n) || n <= 0) throw new ApiFail(400, "bad_request", "seq 不合法");
  return n;
}

function putFavorite(c: ReqCtx): Response {
  const ev = c.core.store.bySeq(seqParam(c));
  if (!ev) return notFound();
  const fav = c.core.chats.addFavorite(ev);
  syncFavorites(c.core);
  return json({ favorite: fav });
}

function deleteFavorite(c: ReqCtx): Response {
  const ok = c.core.chats.removeFavorite(seqParam(c));
  if (ok) syncFavorites(c.core);
  return json({ ok });
}

// 主人与子号都能传 (子号设自己的头像); 按内容哈希存, 重复上传不多写
async function putAvatar(c: ReqCtx): Promise<Response> {
  if (!c.who.owner && !c.who.member) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const mime = (c.req.headers.get("Content-Type") ?? "").split(";")[0]?.trim() ?? "";
  if (!mime.startsWith(IMAGE_PREFIX)) return fail(400, "头像必须是图片");
  const data = await c.req.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_AVATAR_BYTES) return fail(400, `头像不能超过 ${MAX_AVATAR_BYTES / 1024}KB`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const id = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, AVATAR_ID_HEX);
  c.core.chats.putAvatar(id, mime, data);
  return json({ id });
}

function getAvatar(c: ReqCtx): Response {
  const a = c.core.chats.avatar(param(c, 0));
  if (!a) return notFound();
  return new Response(a.data, { headers: { "Content-Type": a.mime, "Cache-Control": IMMUTABLE } });
}

export const CHAT_ROUTES: Route[] = [
  route(GET, PATH_CHAT_MESSAGES, ROOM, chatMessages),
  route(DELETE, PATH_CHAT_MESSAGES, OWNER, clearChat),
  route(POST, PATH_CHAT_AGENTS, OWNER, addAgent),
  route(PATCH, PATH_CHAT_AGENT, OWNER, patchAgent),
  route(DELETE, PATH_CHAT_AGENT, OWNER, removeAgent),
  route(POST, PATH_CHAT_AGENT_ROTATE, OWNER, rotateAgent),
  route(GET, PATH_CHAT_AGENT_PROMPT, OWNER, agentPromptOf),
  route(GET, PATH_AGENT_GUIDE, SEND_SCOPE, agentGuideOf),
  route(POST, PATH_AGENT_GUIDE_ACK, SEND_SCOPE, agentAck),
  route(GET, PATH_FAVORITES, OWNER, (c) =>
    etagged(c.req, c.core.chats.favoritesTag(c.core.store.head()), () => ({ favorites: c.core.chats.favorites((id, seq) => c.core.store.get(id) ?? c.core.store.bySeq(seq)) })),
  ),
  route(PUT, PATH_FAVORITE, OWNER, putFavorite),
  route(DELETE, PATH_FAVORITE, OWNER, deleteFavorite),
  route(PUT, PATH_AVATARS, ROOM, putAvatar),
  route(GET, PATH_AVATAR, ROOM, getAvatar),
  route(GET, PATH_EVENT_BY_SEQ, OWNER, (c) => {
    const ev = c.core.store.bySeq(seqParam(c));
    return ev ? json(ev) : notFound();
  }),
];
