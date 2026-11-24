import { attachFile } from "./files/api";
import {
  checkFeedKinds,
  feedTagsOf,
  feedText,
  parseFeed,
  type FeedData,
  MAX_BATCH,
  PATH_EVENTS,
  PATH_EVENT_ACTIONS,
  PATH_EVENT_GROUPS,
  PATH_EVENT_RESOLVE,
  PATH_MESSAGES,
  PATH_METRICS_LATEST,
  PATH_OVERVIEW,
  PATH_REPORTS,
  PRIORITIES,
  QUERY_BEFORE,
  QUERY_KIND,
  QUERY_LIMIT,
  QUERY_SINCE,
  QUERY_SUBJECTS,
  KINDS,
  globMatch,
  parseEventInput,
  type Envelope,
  type EventInput,
  type IngestResult,
  type Kind,
  type Priority,
  type SourceInfo,
  type SourceRef,
} from "@hx-aioa/protocol";
import { typeInfo } from "./adapters";
import {
  CODE_FORBIDDEN,
  CODE_NOT_FOUND,
  ERR_NO_RESOURCE,
  ERR_TOO_LONG,
  GET,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  MAX_TEXT_LENGTH,
  OWNER_ID,
  OVERVIEW_SCAN,
  POST,
  SRC_API_DEFAULT,
} from "./constants";
import { type Core, OWNER, type Principal, type ReqCtx, type Route, route } from "./core";
import { buildGroups, buildOverview } from "./group";
import { ApiFail, badJson, clampInt, fail, json, readJson } from "./http";
import { textToEventData } from "./legacy";
import { canRead } from "./api-chats";
import { touchAgent } from "./api-presence";
import { refOf } from "./chat";
import { groupOf } from "./store";

const REPORT_LIST_LIMIT = 20;

export function originOf(core: Core, who: Principal, fallbackName = SRC_API_DEFAULT): { source: SourceRef; sourceInfo: SourceInfo | null } {
  if (who.owner) return { source: { id: fallbackName, name: fallbackName }, sourceInfo: null };
  const info = who.key.sourceId ? core.registry.source(who.key.sourceId) : null;
  if (info) {
    const source: SourceRef = { id: info.id, name: info.name, type: info.type };
    const icon = info.icon ?? typeInfo(info.type)?.icon;
    if (icon) source.icon = icon;
    return { source, sourceInfo: info };
  }
  return { source: { id: `key:${who.key.id}`, name: who.key.name, type: "script" }, sourceInfo: null };
}

// 写入事件的公共入口: 频道白名单, key 绑定的默认 subject, 然后进入处理管线
export async function writeEvent(core: Core, who: Principal, input: EventInput, origin = originOf(core, who)): Promise<IngestResult> {
  if (!who.owner) {
    const channel = input.channel ?? origin.sourceInfo?.channel;
    const list = who.key.channels;
    if (list.length && !(channel && list.some((p) => globMatch(p, channel)))) throw new ApiFail(403, CODE_FORBIDDEN, "频道不在该 key 的白名单内");
    if (!input.subject && who.key.subject) input.subject = who.key.subject;
  }
  const feed = input.kind === "event" ? (input.data as { feed?: FeedData } | undefined)?.feed : undefined;
  const target = input.channel ?? origin.sourceInfo?.channel;
  if (feed && target) {
    const meta = core.chats.chat(target);
    const bad = meta?.view === "feed" ? checkFeedKinds(feed.items.map((it) => it.kind), feedTagsOf(meta).tags) : null;
    if (bad) throw new ApiFail(400, "bad_request", bad);
  }
  const ev = await core.pipeline.fromInput(input, origin);
  const out: IngestResult = { id: ev.id, delivered: ev.route?.action === "drop" || ev.kind === "metric" ? 0 : 1 };
  if (ev.channel) out.channel = ev.channel;
  return out;
}

// HTML 卡片与报告同一上限
const MAX_HTML_LENGTH = 64 * 1024;

export function messageInput(raw: Record<string, unknown>): EventInput | string {
  let feed: FeedData | undefined;
  if (raw.feed !== undefined) {
    const f = parseFeed(raw.feed);
    if (typeof f === "string") return f;
    feed = f;
  }
  const text = raw.text || (feed ? feedText(feed) : undefined);
  if (typeof text !== "string" || !text) return "需要 text";
  if (text.length > MAX_TEXT_LENGTH) return ERR_TOO_LONG;
  const title = typeof raw.title === "string" && raw.title ? raw.title : undefined;
  // 只发了 text 但内容整段是 HTML: 当成 HTML 卡片, 摘要用去掉标签的文字
  if (raw.html === undefined && looksHtml(text)) {
    const plain = htmlToText(text).slice(0, MAX_SUMMARY_TEXT) || "HTML 卡片";
    const data = textToEventData(plain, title);
    if (text.length <= MAX_HTML_LENGTH) data.html = text;
    return withMeta({ kind: "event", data }, raw);
  }
  const data = textToEventData(text, title);
  if (feed) data.feed = feed;
  if (raw.html !== undefined) {
    if (typeof raw.html !== "string" || raw.html.length > MAX_HTML_LENGTH) return "html 过大 (上限 64KB)";
    if (raw.html) data.html = raw.html;
  }
  return withMeta({ kind: "event", data }, raw);
}

function withMeta(input: EventInput, raw: Record<string, unknown>): EventInput {
  for (const k of ["channel", "subject"] as const) if (typeof raw[k] === "string" && raw[k]) input[k] = raw[k] as string;
  if (typeof raw.priority === "string" && (PRIORITIES as readonly string[]).includes(raw.priority)) input.priority = raw.priority as Priority;
  return input;
}

const MAX_SUMMARY_TEXT = 500;
const HTML_SHAPE = /^<(!doctype|html|div|section|article|table|p|h[1-6]|style|body|main|span|ul|ol)[\s>]/i;

/** 整段以常见块级标签开头并以 > 结尾才算 HTML, 避免误伤正文里提到的 <tag>。 */
export function looksHtml(text: string): boolean {
  const t = text.trim();
  return HTML_SHAPE.test(t) && t.endsWith(">");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

async function postEvents(c: ReqCtx): Promise<Response> {
  const body = await readJson(c.req);
  if (body === undefined) return badJson();
  const batch = typeof body === "object" && body !== null && Array.isArray((body as { events?: unknown }).events);
  const list = batch ? ((body as { events: unknown[] }).events) : [body];
  if (list.length > MAX_BATCH) return fail(400, `单次最多 ${MAX_BATCH} 条`);
  const results: IngestResult[] = [];
  for (const raw of list) {
    const p = parseEventInput(raw);
    if (!p.ok) return fail(400, batch ? `第 ${results.length + 1} 条: ${p.error}` : p.error);
    results.push(await writeEvent(c.core, c.who, p.value));
  }
  return json(batch ? { results } : results[0]);
}

async function postMessage(c: ReqCtx): Promise<Response> {
  const body = await readJson(c.req);
  if (typeof body !== "object" || body === null) return badJson();
  const input = messageInput(body as Record<string, unknown>);
  if (typeof input === "string") return fail(400, input);
  const file = attachFile(c.core, c.who, (body as Record<string, unknown>).file, input.channel);
  if (typeof file === "string") return fail(400, file);
  if (file && input.kind === "event") input.data = { ...input.data, file };
  // 引用回复: 只能引用自己读得到的群里的消息
  const reply = (body as Record<string, unknown>).reply;
  if (reply !== undefined) {
    const r = typeof reply === "number" ? c.core.store.bySeq(reply) : null;
    const grp = r ? groupOf(r) : null;
    if (!r || !grp || !canRead(c.core, c.who, grp)) return fail(400, "reply 必须是可读群里的消息 seq");
    input.reply = refOf(r);
  }
  const out = await writeEvent(c.core, c.who, input);
  // Agent 发出回复就不再显示 "正在输入"
  if (!c.who.owner && out.channel) c.core.presence.sent(out.channel, c.who.key.id);
  if (!c.who.owner) touchAgent(c.core, c.who.key.id);
  return json(out);
}

function listEvents(c: ReqCtx): Response {
  const since = clampInt(c.url.searchParams.get(QUERY_SINCE), 0, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(c.url.searchParams.get(QUERY_LIMIT), HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
  const kind = c.url.searchParams.get(QUERY_KIND);
  if (kind && !(KINDS as readonly string[]).includes(kind)) return fail(400, "kind 取值错误");
  return json({ events: c.core.store.since(since, limit, (kind as Kind | null) ?? undefined), head: c.core.store.head() });
}

// 用户手动收起: 覆盖写一条 resolved, 其它设备按 id 替换
export function resolveEvent(core: Core, id: string): Envelope {
  const ev = core.store.get(id);
  if (!ev) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_RESOURCE);
  ev.resolved = true;
  if (ev.kind === "event") ev.data = { ...ev.data, status: "resolved" };
  const saved = core.store.put(ev);
  core.sockets.deliverEv(saved);
  return saved;
}

async function eventAction(c: ReqCtx): Promise<Response> {
  const id = decodeURIComponent(c.params[0] ?? "");
  const body = (await readJson(c.req)) as { actionId?: unknown } | undefined;
  const actionId = typeof body?.actionId === "string" ? body.actionId : "";
  if (!actionId) return fail(400, "需要 actionId");
  if (actionId === "resolve") {
    resolveEvent(c.core, id);
    return json({ ok: true, forwarded: false });
  }
  const ev = c.core.store.get(id);
  if (!ev) return fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
  const info = c.core.registry.source(ev.source.id);
  if (!info?.callbackUrl) return json({ ok: true, forwarded: false });
  const res = await fetch(info.callbackUrl, {
    method: POST,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: ev, action: actionId, user: OWNER_ID }),
  }).catch(() => null);
  return json({ ok: Boolean(res?.ok), forwarded: true });
}

function reports(c: ReqCtx): Response {
  const before = clampInt(c.url.searchParams.get(QUERY_BEFORE), Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(c.url.searchParams.get(QUERY_LIMIT), REPORT_LIST_LIMIT, HISTORY_DEFAULT_LIMIT);
  const list = c.core.store.before(before, limit, "report").map((ev) => {
    if (ev.kind !== "report") return ev;
    const { markdown: _m, blocks: _b, html: _h, ...data } = ev.data;
    return { ...ev, data };
  });
  return json({ reports: list });
}

function report(c: ReqCtx): Response {
  const ev = c.core.store.get(decodeURIComponent(c.params[0] ?? ""));
  return ev && ev.kind === "report" ? json(ev) : fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
}

export const EVENT_ROUTES: Route[] = [
  route(GET, PATH_EVENTS, OWNER, listEvents),
  route(POST, PATH_EVENTS, "events:write", postEvents),
  route(POST, PATH_MESSAGES, "messages:send", postMessage),
  route(POST, PATH_EVENT_RESOLVE, OWNER, (c) => {
    resolveEvent(c.core, decodeURIComponent(c.params[0] ?? ""));
    return json({ ok: true });
  }),
  route(POST, PATH_EVENT_ACTIONS, OWNER, eventAction),
  route(GET, PATH_EVENT_GROUPS, OWNER, (c) => json({ groups: buildGroups(c.core.store.recent(OVERVIEW_SCAN)) })),
  route(GET, PATH_OVERVIEW, OWNER, (c) => json(buildOverview(c.core.store.recent(OVERVIEW_SCAN), c.core.agents.list(null, HISTORY_DEFAULT_LIMIT), Date.now()))),
  route(GET, PATH_METRICS_LATEST, OWNER, (c) => {
    const subjects = (c.url.searchParams.get(QUERY_SUBJECTS) ?? "").split(",").filter(Boolean);
    return json({ metrics: c.core.metrics.latestOf(subjects) });
  }),
  route(GET, PATH_REPORTS, OWNER, reports),
  route(GET, `${PATH_REPORTS}/{id}`, OWNER, report),
];
