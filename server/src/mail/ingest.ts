import {
  MAIL_CHANNEL,
  MAIL_SOURCE_PREFIX,
  MAIL_TITLE,
  MAX_TITLE_LENGTH,
  categoryOf,
  extractCode,
  vendorOf,
  type EventData,
  type FileRef,
  type EventInput,
  type IngestResult,
  type MailBodyKind,
  type MailInfo,
  type MailInput,
  type MailVia,
  type SourceInfo,
  type SourceRef,
} from "@hx-aioa/protocol";
import { htmlToText, writeEvent } from "../api-events";
import type { Core, Principal } from "../core";
import { storageOf } from "../files/storage";
import { EventStore } from "../store";
import { applyRules } from "./rules";
import { syncChat } from "../chat-sync";

// 列表摘要与 HTML 卡片的上限, 与普通消息一致
const MAX_SUMMARY = 500;
const MAX_HTML = 64 * 1024;
const NO_SUBJECT = "(无主题)";
const MAIL_ICON = "mail";
const OWNER: Principal = { owner: true };
const BY = "mail";
const HTML_FILE = { name: "原文.html", mime: "text/html; charset=utf-8" };
const TEXT_FILE = { name: "正文.txt", mime: "text/plain; charset=utf-8" };

const clean = (addr: string) => addr.trim().toLowerCase();

/** 一封信 -> 邮件群里的一条事件 + 一行索引。同一个 Message-ID 再来只覆盖不重复。 */
export async function mailIn(core: Core, input: MailInput, via: MailVia, who: Principal = OWNER): Promise<IngestResult> {
  const from = clean(input.from);
  const to = clean(input.to);
  const vendor = vendorOf(from);
  const subject = (input.subject ?? "").trim().slice(0, MAX_TITLE_LENGTH) || NO_SUBJECT;
  const text = input.text?.trim() || (input.html ? htmlToText(input.html) : "");
  const code = input.code ?? extractCode(subject, text);
  const category = categoryOf(from);
  const mail: MailInfo = { from, to, vendor, category, via };
  if (input.name) mail.name = input.name.trim();
  if (input.rcpt && clean(input.rcpt) !== to) mail.rcpt = clean(input.rcpt);
  if (input.list) mail.list = clean(input.list);
  if (code) mail.code = code;
  if (input.spoof) mail.spoof = true;
  const data: EventData = { title: subject, severity: input.spoof ? "warning" : code ? "normal" : "info", mail };
  const summary = text.slice(0, MAX_SUMMARY);
  if (summary) data.summary = summary;
  const source: SourceRef = { id: MAIL_SOURCE_PREFIX + vendor, name: vendor, type: "email", icon: MAIL_ICON };
  const key = input.messageId?.trim();
  const dedupe = key ? EventStore.dedupeOf({ source, dedupeKey: key }) : null;
  // 规则转发过的信重投直接忽略 (转完删掉的也不复活); 已有的信重投只覆盖, 不再触发规则
  if (dedupe && core.mail.forwarded(dedupe)) return { id: "", delivered: 0 };
  const fresh = !dedupe || !core.store.byDedupe(dedupe);
  await keepBody(core, data, input.html, text, dedupe);
  // 冒充的信不响铃, 即使带验证码
  const priority = code && !input.spoof ? "need_me" : "worth_reading";
  const ev: EventInput = { kind: "event", channel: MAIL_CHANNEL, priority, data };
  if (input.ts) ev.ts = input.ts;
  if (key) ev.dedupeKey = key;
  // 来源按厂商分: 群里头像 / 名字显示厂商, 同一家的信能被规则一起处理
  const origin: { source: SourceRef; sourceInfo: SourceInfo | null } = { source, sourceInfo: null };
  const r = await writeEvent(core, who, ev, origin);
  const saved = core.store.get(r.id);
  if (saved) core.mail.add({ ev: saved.id, ts: saved.ts, account: to, vendor, frm: from, subj: subject, cat: category });
  ensureMailChat(core);
  if (saved && fresh && (await applyRules(core, saved)) && dedupe) core.mail.markForwarded(dedupe);
  return r;
}

/**
 * 完整正文: HTML 原文或超过摘要的长文本存 R2 (data.file, 删信时随引用计数删掉), 库里只留摘要。
 * 同一封信重投时沿用已存的文件。没绑 R2 时小 HTML 内联, 长文本只留摘要。
 */
async function keepBody(core: Core, data: EventData, html: string | undefined, text: string, dedupe: string | null): Promise<void> {
  const kind: MailBodyKind | undefined = html ? "html" : text.length > MAX_SUMMARY ? "text" : undefined;
  if (!kind || !data.mail) return;
  const prev = dedupe ? core.store.byDedupe(dedupe) : null;
  const old = prev?.kind === "event" && prev.data.mail?.body === kind ? prev.data.file : undefined;
  const spec = kind === "html" ? HTML_FILE : TEXT_FILE;
  const file: FileRef | null = old ?? (await core.files.save(MAIL_CHANNEL, spec.name, html ?? text, spec.mime, BY, storageOf(await core.config.settings())));
  if (file) data.file = file;
  else if (html && html.length <= MAX_HTML) data.html = html;
  else return;
  data.mail.body = kind;
}

// 第一封信到达时建好邮件群: 标题 "邮件", 用邮件视图
function ensureMailChat(core: Core): void {
  const cur = core.chats.chat(MAIL_CHANNEL);
  if (cur?.view === "mail") return;
  const now = Date.now();
  core.chats.replaceChat({ ...(cur ?? { channel: MAIL_CHANNEL }), title: cur?.title ?? MAIL_TITLE, view: "mail", updated: now });
  syncChat(core, MAIL_CHANNEL);
}
