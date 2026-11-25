import {
  MAIL_CHANNEL,
  MAIL_PREFS_DEFAULT,
  MAX_ID_LENGTH,
  PATH_MAIL_FORWARD,
  PATH_MAIL_PREFS,
  PATH_MAIL_RULES,
  SOURCE_TYPE_USER,
  USER_SOURCE_PREFIX,
  knownSenderDomains,
  parseMailPrefs,
  parseMailRules,
  ruleMatches,
  type Envelope,
  type MailForwarded,
  type MailPrefs,
  type MailPrefsView,
  type MailRule,
  type MailRules,
  type RouteInfo,
} from "@hx-aioa/protocol";
import { htmlToText, messageInput } from "../api-events";
import { CODE_NOT_FOUND, GET, OWNER_NAME, POST, PUT } from "../constants";
import { type Core, OWNER, type ReqCtx, type Route, route } from "../core";
import { ApiFail, badJson, fail, json, readJson } from "../http";
import { removeMessage } from "../recall";

const KEY_PREFS = "prefs";
const KEY_RULES = "rules";
// 转发正文上限: 够 Agent 读懂, 不把整封资讯塞进群
const MAX_FWD_TEXT = 3500;
const TZ_MS = 8 * 3600_000;
const ROUTE_FWD: RouteInfo = { action: "silent", channels: ["ws"], reason: "邮件转发" };
const ERR_NO_MAIL = "邮件不存在";
const ERR_NO_CHAT = "目标群不存在";

export const mailPrefs = (core: Core): MailPrefs => core.mail.getConf<MailPrefs>(KEY_PREFS, MAIL_PREFS_DEFAULT);
const mailRules = (core: Core): MailRule[] => core.mail.getConf<MailRule[]>(KEY_RULES, []);
const timeOf = (ts: number) => new Date(ts + TZ_MS).toISOString().slice(0, 16).replace("T", " ");

async function plainOf(core: Core, ev: Envelope): Promise<string> {
  if (ev.kind !== "event") return "";
  const { html, file, mail, summary } = ev.data;
  const raw = html ?? (file ? await core.files.text(file.id) : null);
  if (raw === null) return summary ?? "";
  return mail?.body === "html" ? htmlToText(raw) : raw;
}

/**
 * 把一封信以主人的名义转进群: 标题, 发件人, 收件, 时间, 纯文本正文 (截断), 原文作附件。
 * 来源是主人 (user:), 所以群里监听的 Agent 会被叫醒; 路由安静, 信本身已经提醒过。
 */
export async function forwardMail(core: Core, ev: Envelope, channel: string, by?: string): Promise<Envelope> {
  if (ev.kind !== "event" || !ev.data.mail) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_MAIL);
  if (!core.chats.chat(channel)) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_CHAT);
  const m = ev.data.mail;
  const body = (await plainOf(core, ev)).trim();
  const cut = body.length > MAX_FWD_TEXT ? `${body.slice(0, MAX_FWD_TEXT)}\n...(已截断, 原文见附件)` : body;
  const head = [`转发邮件: ${ev.data.title}`, `发件人: ${m.name ? `${m.name} <${m.from}>` : m.from}`, m.to ? `收件: ${m.to}` : "", `时间: ${timeOf(ev.ts)}`].filter(Boolean);
  const input = messageInput({ text: `${head.join("\n")}\n\n${cut}` });
  if (typeof input === "string") throw new ApiFail(400, "BAD_REQUEST", input);
  input.channel = channel;
  input.fwd = { src: m.vendor, ts: ev.ts, channel: MAIL_CHANNEL };
  if (ev.data.file && input.kind === "event") input.data = { ...input.data, file: ev.data.file };
  const uid = by ?? core.users.ownerId();
  const user = uid ? core.users.get(uid) : undefined;
  const source = { id: USER_SOURCE_PREFIX + (uid ?? "owner"), name: user?.display || user?.name || OWNER_NAME, type: SOURCE_TYPE_USER };
  return core.pipeline.fromInput(input, { source, ...(uid ? { by: uid } : {}) }, ROUTE_FWD);
}

/** 新信到达后按规则自动转; 冒充的信不转。同一个群只转一次, 有一条要求不保留就删掉。返回是否命中。 */
export async function applyRules(core: Core, ev: Envelope): Promise<boolean> {
  if (ev.kind !== "event" || !ev.data.mail || ev.data.mail.spoof) return false;
  const hits = mailRules(core).filter((r) => ruleMatches(r, ev.data.mail!, ev.data.title));
  const done = new Set<string>();
  for (const r of hits) {
    if (done.has(r.channel)) continue;
    done.add(r.channel);
    await forwardMail(core, ev, r.channel).catch((e) => console.warn("mail rule", r.id, String(e)));
  }
  if (hits.some((r) => !r.keep)) await removeMessage(core, OWNER_PRINCIPAL, ev.seq, "delete").catch(() => undefined);
  return hits.length > 0;
}
const OWNER_PRINCIPAL = { owner: true } as const;

async function forward(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as { channel?: unknown } | undefined;
  if (!body || typeof body !== "object") return badJson();
  const channel = typeof body.channel === "string" ? body.channel.trim() : "";
  if (!channel || channel.length > MAX_ID_LENGTH) return fail(400, "需要 channel");
  const ev = c.core.store.get(decodeURIComponent(c.params[0] ?? ""));
  if (!ev || ev.deleted) return fail(404, ERR_NO_MAIL, CODE_NOT_FOUND);
  const out = await forwardMail(c.core, ev, channel, c.who.owner ? c.who.user?.id : undefined);
  return json({ id: out.id, channel } satisfies MailForwarded);
}

async function putPrefs(c: ReqCtx): Promise<Response> {
  const p = parseMailPrefs(await readJson(c.req));
  if (typeof p === "string") return fail(400, p);
  c.core.mail.setConf(KEY_PREFS, p);
  return json(p);
}

async function putRules(c: ReqCtx): Promise<Response> {
  const r = parseMailRules(await readJson(c.req));
  if (typeof r === "string") return fail(400, r);
  c.core.mail.setConf(KEY_RULES, r);
  return json({ rules: r } satisfies MailRules);
}

export const MAIL_RULE_ROUTES: Route[] = [
  route(GET, PATH_MAIL_PREFS, OWNER, (c) => json({ ...mailPrefs(c.core), known: knownSenderDomains() } satisfies MailPrefsView)),
  route(PUT, PATH_MAIL_PREFS, OWNER, putPrefs),
  route(GET, PATH_MAIL_RULES, OWNER, (c) => json({ rules: mailRules(c.core) } satisfies MailRules)),
  route(PUT, PATH_MAIL_RULES, OWNER, putRules),
  route(POST, PATH_MAIL_FORWARD, OWNER, forward),
];
