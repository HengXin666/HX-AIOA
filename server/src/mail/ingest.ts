import {
  MAIL_CHANNEL,
  MAIL_SOURCE_PREFIX,
  MAIL_TITLE,
  MAX_TITLE_LENGTH,
  extractCode,
  vendorOf,
  type ChatSyncFrame,
  type EventData,
  type EventInput,
  type IngestResult,
  type MailInfo,
  type MailInput,
  type MailVia,
  type SourceInfo,
  type SourceRef,
} from "@hx-aioa/protocol";
import { htmlToText, writeEvent } from "../api-events";
import type { Core, Principal } from "../core";

// 列表摘要与 HTML 卡片的上限, 与普通消息一致
const MAX_SUMMARY = 500;
const MAX_HTML = 64 * 1024;
const NO_SUBJECT = "(无主题)";
const MAIL_ICON = "mail";
const OWNER: Principal = { owner: true };

const clean = (addr: string) => addr.trim().toLowerCase();

/** 一封信 -> 邮件群里的一条事件 + 一行索引。同一个 Message-ID 再来只覆盖不重复。 */
export async function mailIn(core: Core, input: MailInput, via: MailVia, who: Principal = OWNER): Promise<IngestResult> {
  const from = clean(input.from);
  const to = clean(input.to);
  const vendor = vendorOf(from);
  const subject = (input.subject ?? "").trim().slice(0, MAX_TITLE_LENGTH) || NO_SUBJECT;
  const text = input.text?.trim() || (input.html ? htmlToText(input.html) : "");
  const code = input.code ?? extractCode(subject, text);
  const mail: MailInfo = { from, to, vendor, via };
  if (input.name) mail.name = input.name.trim();
  if (code) mail.code = code;
  const data: EventData = { title: subject, severity: code ? "normal" : "info", mail };
  const summary = text.slice(0, MAX_SUMMARY);
  if (summary) data.summary = summary;
  if (input.html && input.html.length <= MAX_HTML) data.html = input.html;
  const ev: EventInput = { kind: "event", channel: MAIL_CHANNEL, priority: code ? "need_me" : "worth_reading", data };
  if (input.ts) ev.ts = input.ts;
  if (input.messageId) ev.dedupeKey = input.messageId.trim();
  // 来源按厂商分: 群里头像 / 名字显示厂商, 同一家的信能被规则一起处理
  const source: SourceRef = { id: MAIL_SOURCE_PREFIX + vendor, name: vendor, type: "email", icon: MAIL_ICON };
  const origin: { source: SourceRef; sourceInfo: SourceInfo | null } = { source, sourceInfo: null };
  const r = await writeEvent(core, who, ev, origin);
  const saved = core.store.get(r.id);
  if (saved) core.mail.add({ ev: saved.id, ts: saved.ts, account: to, vendor, frm: from });
  ensureMailChat(core);
  return r;
}

// 第一封信到达时建好邮件群: 标题 "邮件", 用邮件视图
function ensureMailChat(core: Core): void {
  const cur = core.chats.chat(MAIL_CHANNEL);
  if (cur?.view === "mail") return;
  const now = Date.now();
  core.chats.replaceChat({ ...(cur ?? { channel: MAIL_CHANNEL }), title: cur?.title ?? MAIL_TITLE, view: "mail", updated: now });
  core.sockets.toAllClients({ t: "chat_sync", topic: "chats", channel: MAIL_CHANNEL } satisfies ChatSyncFrame);
}
