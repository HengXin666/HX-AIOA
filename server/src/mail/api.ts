import {
  MAIL_PAGE_DEFAULT,
  MAIL_PAGE_MAX,
  MAX_MAIL_TEXT,
  PATH_MAIL,
  PATH_MAIL_FACETS,
  PATH_MAIL_HX_EMAIL,
  QUERY_ACCOUNT,
  QUERY_BEFORE,
  QUERY_LIMIT,
  QUERY_VENDOR,
  parseMailInput,
  type Envelope,
  type MailInput,
  type MailList,
} from "@hx-aioa/protocol";
import { GET, POST } from "../constants";
import { OWNER, type ReqCtx, type Route, route } from "../core";
import { badJson, clampInt, fail, json, readJson } from "../http";
import { mailIn } from "./ingest";

const WRITE = "events:write";
const HX_EMAIL_EVENT = "new_mail";
const HX_EMAIL_TEST = "test";

function list(c: ReqCtx): Response {
  const q = c.url.searchParams;
  const limit = clampInt(q.get(QUERY_LIMIT), MAIL_PAGE_DEFAULT, MAIL_PAGE_MAX);
  const ids = c.core.mail.list({
    limit,
    vendor: q.get(QUERY_VENDOR) || undefined,
    account: q.get(QUERY_ACCOUNT) || undefined,
    before: clampInt(q.get(QUERY_BEFORE), 0, Number.MAX_SAFE_INTEGER) || undefined,
  });
  const messages = ids.slice(0, limit).flatMap((id) => c.core.store.get(id) ?? []) as Envelope[];
  return json({ messages, more: ids.length > limit } satisfies MailList);
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
  route(POST, PATH_MAIL, WRITE, push),
  route(POST, PATH_MAIL_HX_EMAIL, WRITE, hxEmail),
];
