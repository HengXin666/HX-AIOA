import {
  DIGEST_KINDS,
  MAX_AGENT_READS,
  MAX_AVATAR_BYTES,
  MAX_CHAT_AGENTS,
  MAX_ID_LENGTH,
  MAX_TITLE_LENGTH,
  PATH_AVATAR,
  PATH_AVATARS,
  PATH_CHAT,
  PATH_CHAT_AGENT,
  PATH_AGENT_GUIDE,
  PATH_AGENT_GUIDE_ACK,
  PATH_CHAT_AGENT_PROMPT,
  HEADER_GUIDE_VERSION,
  PATH_CHAT_AGENT_ROTATE,
  PATH_CHAT_AGENTS,
  PATH_CHAT_MESSAGES,
  PATH_CHATS,
  PATH_EVENT_BY_SEQ,
  PATH_FAVORITE,
  PATH_FAVORITES,
  QUERY_BEFORE,
  QUERY_LIMIT,
  QUERY_SINCE,
  globMatch,
  type ChatAgent,
  type ChatCleared,
  type ChatMeta,
  type ChatPatch,
  type ChatSyncFrame,
  type OnboardResult,
  type Scope,
} from "@hx-aioa/protocol";
import { agentBootstrap, agentGuide } from "./agent-prompt";
import { CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, ERR_NO_RESOURCE, GET, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT, PATCH, POST, PUT } from "./constants";
import { type Core, OWNER, type Principal, ROOM, type ReqCtx, type Route, route } from "./core";
import { memberView, ownerView, roleIn } from "./room-access";
import { autoUpgrade } from "./plugins/update";
import { ApiFail, clampInt, fail, json, readJson } from "./http";

const AGENT_SCOPES: Scope[] = ["messages:send", "events:write"];
const READ_SCOPE: Scope = "events:read";
const AVATAR_ID_HEX = 24;
const IMMUTABLE = "public, max-age=31536000, immutable";
const HEADER_ETAG = "ETag";
const HEADER_IF_NONE_MATCH = "If-None-Match";
const IMAGE_PREFIX = "image/";

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
// 线上一律给 https 地址, 本地调试保持原样
export const baseOf = (u: URL) => (LOCAL_HOSTS.includes(u.hostname) ? u.origin : `https://${u.host}`);
const param = (c: ReqCtx, i: number) => decodeURIComponent(c.params[i] ?? "");
const notFound = () => fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function sync(core: Core, topic: ChatSyncFrame["topic"], channel?: string): void {
  const frame = { t: "chat_sync", topic, ...(channel ? { channel } : {}) } satisfies ChatSyncFrame;
  // 群资料子号也要知道, 收藏只是主人的
  if (topic === "chats") core.sockets.toAllClients(frame);
  else core.sockets.toV1Clients(frame);
}

// 资料带弱 ETag, 没变时 304, 客户端缓存直接用
function cached(req: Request, tag: string, body: unknown): Response {
  const etag = `W/"${tag}"`;
  if (req.headers.get(HEADER_IF_NONE_MATCH) === etag) return new Response(null, { status: 304, headers: { [HEADER_ETAG]: etag } });
  const res = json(body);
  res.headers.set(HEADER_ETAG, etag);
  return res;
}

export function canRead(core: Core, who: Principal, channel: string): boolean {
  if (who.owner) return true;
  if (who.member) return roleIn(core, who, channel) !== null;
  return who.key.scopes.includes(READ_SCOPE) && who.key.channels.some((p) => globMatch(p, channel));
}

function visibleChats(c: ReqCtx): ChatMeta[] {
  if (c.who.owner) return c.core.chats.chats().map((m) => ownerView(c.core, m));
  const member = c.who.member;
  if (member) return c.core.rooms.roomsOf(member.user.id).flatMap((m) => memberView(c.core, m.grp, member.user.id) ?? []);
  return c.core.chats.chats().filter((m) => canRead(c.core, c.who, m.channel)).map(({ agents: _a, ...rest }) => rest);
}

function listChats(c: ReqCtx): Response {
  if (!c.who.owner && !c.who.member && !c.who.key.scopes.includes(READ_SCOPE)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const visible = visibleChats(c);
  const tag = `${visible.length}-${Math.max(0, ...visible.map((m) => m.updated))}`;
  return cached(c.req, tag, { chats: visible });
}

function parsePatch(raw: unknown): ChatPatch | string {
  if (!isObj(raw)) return "资料必须是对象";
  const out: ChatPatch = {};
  if ("title" in raw) {
    if (raw.title !== null && !(typeof raw.title === "string" && raw.title.length <= MAX_TITLE_LENGTH)) return "title 过长";
    out.title = (raw.title as string | null) ?? "";
  }
  if ("avatar" in raw) {
    if (raw.avatar !== null && typeof raw.avatar !== "string") return "avatar 必须是头像 id";
    out.avatar = (raw.avatar as string | null) ?? "";
  }
  for (const k of ["pinned", "muted"] as const) if (k in raw) out[k] = raw[k] === true;
  if ("read" in raw) {
    if (typeof raw.read !== "number") return "read 必须是 seq";
    out.read = raw.read;
  }
  if ("digest" in raw) {
    if (raw.digest !== null && !(DIGEST_KINDS as readonly unknown[]).includes(raw.digest)) return "digest 只能是 daily 或 weekly";
    // null 表示取消, 由 patchChat 删除该字段
    (out as Record<string, unknown>).digest = raw.digest;
  }
  return out;
}

async function patchChat(c: ReqCtx): Promise<Response> {
  const channel = param(c, 0);
  if (!channel || channel.length > MAX_ID_LENGTH) return fail(400, "群名不合法");
  const p = parsePatch(await readJson(c.req));
  if (typeof p === "string") return fail(400, p);
  const role = roleIn(c.core, c.who, channel);
  if (!role) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  // 子号: 置顶, 免打扰, 已读是自己的; 管理员还能改标题和头像
  if (role !== "owner") {
    const uid = c.who.owner ? "" : (c.who.member?.user.id ?? "");
    const { pinned, muted, read, title, avatar } = p;
    c.core.rooms.patchPrefs(channel, uid, { ...(pinned !== undefined ? { pinned } : {}), ...(muted !== undefined ? { muted } : {}), ...(read !== undefined ? { read } : {}) });
    if (role === "admin" && (title !== undefined || avatar !== undefined)) {
      c.core.chats.patchChat(channel, { ...(title !== undefined ? { title } : {}), ...(avatar !== undefined ? { avatar } : {}) });
      sync(c.core, "chats", channel);
    }
    return json({ chat: memberView(c.core, channel, uid) });
  }
  const meta = c.core.chats.patchChat(channel, p);
  sync(c.core, "chats", channel);
  return json({ chat: meta });
}

function chatMessages(c: ReqCtx): Response {
  const channel = param(c, 0);
  if (!canRead(c.core, c.who, channel)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const limit = clampInt(c.url.searchParams.get(QUERY_LIMIT), HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
  // before: 向前翻页, 群键与客户端一致 (没写 channel 的按来源名, 本机发出的归备忘)
  const before = c.url.searchParams.get(QUERY_BEFORE);
  if (before !== null) {
    const messages = c.core.store.groupBefore(channel, clampInt(before, 1, Number.MAX_SAFE_INTEGER), limit);
    return json({ messages, head: c.core.store.head() });
  }
  const since = clampInt(c.url.searchParams.get(QUERY_SINCE), 0, Number.MAX_SAFE_INTEGER);
  const messages = c.core.store.inChannel(channel, since, limit);
  return json({ messages, head: messages.at(-1)?.seq ?? since });
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
  sync(c.core, "chats", channel);
  return json({ deleted, cleared } satisfies ChatCleared);
}

type AgentInput = { name: string; reads: string[] };
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
  return out;
}

function agentOf(meta: ChatMeta | null, keyId: string): ChatAgent {
  const a = meta?.agents?.find((x) => x.keyId === keyId);
  if (!a) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_RESOURCE);
  return a;
}

function saveAgents(core: Core, channel: string, agents: ChatAgent[]): ChatMeta {
  const meta = core.chats.patchChat(channel, {});
  const next = { ...meta, agents };
  core.chats.replaceChat(next);
  sync(core, "chats", channel);
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
  const agent: ChatAgent = { ...draft, keyId: info.id, created: Date.now(), pending: true, ...(plugin ? { plugin } : {}) };
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

// 专属指令: 插件装的 Agent 额外带上插件提示词
function guideFor(core: Core, base: string, channel: string, agent: ChatAgent) {
  const title = titleOf(core, channel);
  return agentGuide(base, channel, title, agent, agent.plugin ? core.plugins.promptFor(agent.plugin, base, channel, title) : undefined);
}

async function addAgent(c: ReqCtx): Promise<Response> {
  const channel = param(c, 0);
  const p = parseAgent(await readJson(c.req), false);
  if (typeof p === "string") return fail(400, p);
  if ((c.core.chats.chat(channel)?.agents ?? []).length >= MAX_CHAT_AGENTS) return fail(400, `每个群最多 ${MAX_CHAT_AGENTS} 个 Agent`);
  const { agent, key } = await createAgent(c.core, channel, p.name!, p.reads ?? []);
  return json({ agent, prompt: agentBootstrap(baseOf(c.url), titleOf(c.core, channel), key), key } satisfies OnboardResult);
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
  const agent: ChatAgent = { ...rest, keyId: info.id, rotated: Date.now(), pending: true };
  saveAgents(c.core, channel, (meta?.agents ?? []).map((x) => (x.keyId === old.keyId ? agent : x)));
  if (agent.plugin) {
    // 插件记录跟着换 keyId, 否则卸载时找不到这个 Agent
    const rec = c.core.plugins.get(agent.plugin);
    if (rec?.keyId === old.keyId) c.core.plugins.setInstall({ ...rec, keyId: info.id });
  }
  const job = agent.plugin ? (c.core.plugins.job(agent.plugin) ?? {}) : undefined;
  return json({ agent, prompt: agentBootstrap(baseOf(c.url), titleOf(c.core, channel), key, job), key } satisfies OnboardResult);
}

async function patchAgent(c: ReqCtx): Promise<Response> {
  const channel = param(c, 0);
  const meta = c.core.chats.chat(channel);
  const old = agentOf(meta, param(c, 1));
  const p = parseAgent(await readJson(c.req), true);
  if (typeof p === "string") return fail(400, p);
  const base = baseOf(c.url);
  const agent: ChatAgent = { ...old, ...p };
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
  return json({ agent });
}

function removeAgent(c: ReqCtx): Response {
  dropAgent(c.core, param(c, 0), param(c, 1));
  return json({ ok: true });
}

function agentPromptOf(c: ReqCtx): Response {
  const channel = param(c, 0);
  const agent = agentOf(c.core.chats.chat(channel), param(c, 1));
  return json({ agent, prompt: guideFor(c.core, baseOf(c.url), channel, agent).text });
}

// 按 key 找到它所在的群和 Agent 资料
function agentByKey(c: ReqCtx): { channel: string; meta: ChatMeta; agent: ChatAgent } {
  const keyId = c.who.owner ? null : c.who.key.id;
  for (const meta of keyId ? c.core.chats.chats() : []) {
    const agent = meta.agents?.find((a) => a.keyId === keyId);
    if (agent) return { channel: meta.channel, meta, agent };
  }
  throw new ApiFail(403, CODE_FORBIDDEN, "这把密钥不是群里接入的 Agent");
}

async function agentGuideOf(c: ReqCtx): Promise<Response> {
  const { channel, agent } = agentByKey(c);
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
  const next: ChatAgent = { ...agent, joined: Date.now(), pending: false };
  saveAgents(c.core, channel, (meta.agents ?? []).map((x) => (x.keyId === agent.keyId ? next : x)));
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
  sync(c.core, "favorites");
  return json({ favorite: fav });
}

function deleteFavorite(c: ReqCtx): Response {
  const ok = c.core.chats.removeFavorite(seqParam(c));
  if (ok) sync(c.core, "favorites");
  return json({ ok });
}

async function putAvatar(c: ReqCtx): Promise<Response> {
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
  route(GET, PATH_CHATS, ROOM, listChats),
  route(PATCH, PATH_CHAT, ROOM, patchChat),
  route(GET, PATH_CHAT_MESSAGES, ROOM, chatMessages),
  route(DELETE, PATH_CHAT_MESSAGES, OWNER, clearChat),
  route(POST, PATH_CHAT_AGENTS, OWNER, addAgent),
  route(PATCH, PATH_CHAT_AGENT, OWNER, patchAgent),
  route(DELETE, PATH_CHAT_AGENT, OWNER, removeAgent),
  route(POST, PATH_CHAT_AGENT_ROTATE, OWNER, rotateAgent),
  route(GET, PATH_CHAT_AGENT_PROMPT, OWNER, agentPromptOf),
  route(GET, PATH_AGENT_GUIDE, SEND_SCOPE, agentGuideOf),
  route(POST, PATH_AGENT_GUIDE_ACK, SEND_SCOPE, agentAck),
  route(GET, PATH_FAVORITES, OWNER, (c) => cached(c.req, c.core.chats.favoritesTag(), { favorites: c.core.chats.favorites() })),
  route(PUT, PATH_FAVORITE, OWNER, putFavorite),
  route(DELETE, PATH_FAVORITE, OWNER, deleteFavorite),
  route(PUT, PATH_AVATARS, OWNER, putAvatar),
  route(GET, PATH_AVATAR, ROOM, getAvatar),
  route(GET, PATH_EVENT_BY_SEQ, OWNER, (c) => {
    const ev = c.core.store.bySeq(seqParam(c));
    return ev ? json(ev) : notFound();
  }),
];
