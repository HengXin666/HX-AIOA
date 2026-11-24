import {
  MAIL_PAGE_DEFAULT,
  MAIL_PAGE_MAX,
  MAIL_SEARCH_MAX,
  MAX_MAIL_TEXT,
  PATH_MAIL,
  PATH_MAIL_BODY,
  PATH_MAIL_FACETS,
  PATH_MAIL_HX_EMAIL,
  PATH_MAIL_ICON,
  QUERY_ACCOUNT,
  QUERY_BEFORE,
  QUERY_CATEGORY,
  QUERY_LIMIT,
  QUERY_MAIL_SEARCH,
  QUERY_VENDOR,
  parseMailInput,
  type Envelope,
  type MailBody,
  type MailInput,
  type MailList,
} from "@hx-aioa/protocol";
import { CODE_NOT_FOUND, GET, POST } from "../constants";
import { OWNER, type ReqCtx, type Route, route } from "../core";
import { badJson, clampInt, fail, json, readJson } from "../http";
import { mailIn } from "./ingest";
import { mailIcon } from "./icon";

const WRITE = "events:write";
const HX_EMAIL_EVENT = "new_mail";
const HX_EMAIL_TEST = "test";
const ERR_NO_BODY = "这封信没有完整正文";
const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textPage = (t: string) => `<pre style="white-space:pre-wrap;word-break:break-word;font:inherit">${escapeHtml(t)}</pre>`;

/** 列表只要摘要: 去掉内联 HTML, 正文另取 (GET /mail/{id}/body)。 */
function slim(ev: Envelope): Envelope {
  if (ev.kind !== "event" || ev.data.html === undefined) return ev;
  const { html: _h, ...data } = ev.data;
  return { ...ev, data };
}

function list(c: ReqCtx): Response {
  const q = c.url.searchParams;
  const limit = clampInt(q.get(QUERY_LIMIT), MAIL_PAGE_DEFAULT, MAIL_PAGE_MAX);
  const ids = c.core.mail.list({
    limit,
    vendor: q.get(QUERY_VENDOR) || undefined,
    // 空串 = 未知收件人, 也是一个可筛的账号
    account: q.has(QUERY_ACCOUNT) ? (q.get(QUERY_ACCOUNT) ?? "") : undefined,
    category: q.get(QUERY_CATEGORY) || undefined,
    before: clampInt(q.get(QUERY_BEFORE), 0, Number.MAX_SAFE_INTEGER) || undefined,
    q: q.get(QUERY_MAIL_SEARCH)?.trim().slice(0, MAIL_SEARCH_MAX) || undefined,
  });
  const messages = ids.slice(0, limit).flatMap((id) => c.core.store.get(id) ?? []).map(slim);
  return json({ messages, more: ids.length > limit } satisfies MailList);
}

/** 完整正文: 内联 HTML, 或 R2 里的原文 / 长文本 (文本转成可显示的 HTML)。 */
async function body(c: ReqCtx): Promise<Response> {
  const ev = c.core.store.get(decodeURIComponent(c.params[0] ?? ""));
  if (!ev || ev.kind !== "event" || ev.deleted || !ev.data.mail) return fail(404, ERR_NO_BODY, CODE_NOT_FOUND);
  const { html, file, mail } = ev.data;
  const raw = html ?? (file ? await c.core.files.text(file.id) : null);
  if (raw === null) return fail(404, ERR_NO_BODY, CODE_NOT_FOUND);
  return json({ html: mail.body === "text" ? textPage(raw) : raw } satisfies MailBody);
}

async function push(c: ReqCtx): Promise<Response> {
  const body = await readJson(c.req);
  if (body === undefined) return badJson();
  const p = parseMailInput(body);
  if (!p.ok) return fail(400, p.error);
  return json(await mailIn(c.core, p.value, "api", c.who));
}

// HX-Email Webhook 原样接收: { event, message_id, usable_email, message: { from, to, subject, body, received_at, verification_code } }
async function hxEmail(c: ReqCtx): Promise<Response> {
  const body = (await readJson(c.req)) as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return badJson();
  if (body.event === HX_EMAIL_TEST) return json({ ok: true });
  if (body.event !== HX_EMAIL_EVENT) return fail(400, "只接收 new_mail 事件");
  const m = (body.message ?? {}) as Record<string, unknown>;
  const usable = (body.usable_email ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const input: MailInput = { from: str(m.from), to: str(usable.address) || str(m.to) };
  const subject = str(m.subject);
  const text = str(m.body).slice(0, MAX_MAIL_TEXT);
  if (subject) input.subject = subject;
  if (text) input.text = text;
  if (str(m.verification_code)) input.code = str(m.verification_code);
  if (body.message_id !== undefined) input.messageId = `hx-email:${String(body.message_id)}`;
  const p = parseMailInput(input);
  if (!p.ok) return fail(400, p.error);
  return json(await mailIn(c.core, p.value, "hx-email", c.who));
}

export const MAIL_ROUTES: Route[] = [
  route(GET, PATH_MAIL, OWNER, list),
  route(GET, PATH_MAIL_FACETS, OWNER, (c) => json(c.core.mail.facets())),
  route(GET, PATH_MAIL_BODY, OWNER, body),
  route(GET, PATH_MAIL_ICON, OWNER, (c) => mailIcon(decodeURIComponent(c.params[0] ?? ""))),
  route(POST, PATH_MAIL, WRITE, push),
  route(POST, PATH_MAIL_HX_EMAIL, WRITE, hxEmail),
];
