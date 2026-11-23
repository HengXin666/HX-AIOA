import { MAX_MAIL_TEXT, type MailInput } from "@hx-aioa/protocol";
import PostalMime, { type Address, type Email } from "postal-mime";

// 超过这个大小直接拒收, 退信给发件人
const MAX_RAW_BYTES = 10 * 1024 * 1024;
const ERR_TOO_BIG = "邮件过大";
const FWD_HEADER = "x-forwarded-for";

const addrs = (list?: Address[]): string[] => (list ?? []).flatMap((a) => (a.address ? [a.address] : (a.group ?? []).map((g) => g.address)));
const header = (mail: Email, key: string) => mail.headers.find((h) => h.key === key)?.value.trim();

/**
 * 收件账号: 被转发时是原收件地址, 不然是 CF 投递的地址。
 * Gmail 转发带 X-Forwarded-For: 原地址 目标地址; Outlook 等保留原 To 头。
 */
export function accountOf(mail: Email, envelopeTo: string): string {
  const fwd = header(mail, FWD_HEADER)?.split(/[\s,]+/)[0];
  if (fwd?.includes("@")) return fwd;
  const to = addrs(mail.to).map((a) => a.toLowerCase());
  const target = envelopeTo.toLowerCase();
  if (to.length === 0 || to.includes(target)) return target;
  return to[0] ?? target;
}

export async function parseRaw(raw: ReadableStream | ArrayBuffer, envelopeFrom: string, envelopeTo: string): Promise<MailInput> {
  const mail = await PostalMime.parse(raw);
  const from = mail.from?.address || envelopeFrom;
  const input: MailInput = { from, to: accountOf(mail, envelopeTo) };
  if (mail.from?.name) input.name = mail.from.name;
  if (mail.subject) input.subject = mail.subject;
  if (mail.text) input.text = mail.text.slice(0, MAX_MAIL_TEXT);
  if (mail.html) input.html = mail.html.slice(0, MAX_MAIL_TEXT);
  if (mail.messageId) input.messageId = mail.messageId;
  const ts = mail.date ? Date.parse(mail.date) : NaN;
  if (Number.isFinite(ts)) input.ts = Math.min(ts, Date.now());
  return input;
}

/** Worker 的 email 入口: 解析在 Worker 里做, Hub 只收结构化结果。 */
export async function handleEmail(msg: ForwardableEmailMessage, deliver: (input: MailInput) => Promise<void>): Promise<void> {
  if (msg.rawSize > MAX_RAW_BYTES) {
    msg.setReject(ERR_TOO_BIG);
    return;
  }
  const input = await parseRaw(msg.raw, msg.from, msg.to);
  await deliver(input);
}
