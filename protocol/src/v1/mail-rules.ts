import { API_V1, MAX_ID_LENGTH } from "./constants";
import { domainOf, isKnownSender, type MailCategory, type MailInfo } from "./mail";

// 邮件详情的显示偏好 (远程图片, 样式) 与自动转发规则; 存服务端, 各端共用

export const PATH_MAIL_PREFS = `${API_V1}/mail/prefs`;
export const PATH_MAIL_RULES = `${API_V1}/mail/rules`;
/** 把一封信转进群 (群里有 Agent 时 Agent 会被叫醒处理)。 */
export const PATH_MAIL_FORWARD = `${API_V1}/mail/{id}/forward`;

/** 远程图片默认策略: known = 只放行白名单 (分类表里认识的厂商), all = 全部放行, none = 全部拦截。 */
export const MAIL_IMAGE_POLICIES = ["known", "all", "none"] as const;
export type MailImagePolicy = (typeof MAIL_IMAGE_POLICIES)[number];
export const MAIL_IMAGES = ["show", "block"] as const;
export type MailImages = (typeof MAIL_IMAGES)[number];
/** adapt = 深色时改背景与文字色, original = 原样, text = 纯文本。 */
export const MAIL_STYLES = ["adapt", "original", "text"] as const;
export type MailStyle = (typeof MAIL_STYLES)[number];

/** 按发件地址或域名 (含上级域名) 记的偏好, 键为小写地址 (a@b.com) 或域名 (b.com)。 */
export type MailSenderPref = { images?: MailImages; style?: MailStyle };
export type MailPrefs = { images: MailImagePolicy; senders: Record<string, MailSenderPref> };
/** GET /mail/prefs 额外给白名单域名 (只读)。 */
export type MailPrefsView = MailPrefs & { known: string[] };
export const MAIL_PREFS_DEFAULT: MailPrefs = { images: "known", senders: {} };
export const MAIL_SENDERS_MAX = 500;
const MAX_KEY = 254;

/** 自动转发规则: 条件全部满足才转; 空条件不算。subject 为标题关键词 (不分大小写)。keep=false 时转完从邮件列表删掉。 */
export type MailRule = {
  id: string;
  on: boolean;
  from?: string;
  domain?: string;
  category?: MailCategory;
  subject?: string;
  to?: string;
  channel: string;
  keep: boolean;
};
export const MAIL_RULES_MAX = 50;
export type MailRules = { rules: MailRule[] };
export type MailForwardInput = { channel: string };
export type MailForwarded = { id: string; channel: string };

const has = (o: Record<string, unknown>, k: string, v: readonly string[]) => typeof o[k] === "string" && v.includes(o[k] as string);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 发件人偏好: 先找地址, 再从完整域名逐级往上找。 */
export function senderPref(p: MailPrefs, from: string): MailSenderPref {
  const addr = from.trim().toLowerCase();
  const hit = p.senders[addr];
  for (let d = domainOf(addr); d.includes("."); d = d.slice(d.indexOf(".") + 1)) {
    const v = p.senders[d];
    if (v) return { ...v, ...hit };
  }
  return hit ?? {};
}

/** 能否加载远程图片: 发件人设置优先; 冒充的信只看明确放行; 再按默认策略。 */
export function imagesAllowed(p: MailPrefs, from: string, spoof = false): boolean {
  const own = senderPref(p, from).images;
  if (own) return own === "show";
  if (spoof) return false;
  return p.images === "all" || (p.images === "known" && isKnownSender(from));
}

export const styleOf = (p: MailPrefs, from: string): MailStyle => senderPref(p, from).style ?? "adapt";

export function parseMailPrefs(raw: unknown): MailPrefs | string {
  if (!isObj(raw)) return "需要 JSON 对象";
  if (!has(raw, "images", MAIL_IMAGE_POLICIES)) return "images 只能是 known / all / none";
  const senders: Record<string, MailSenderPref> = {};
  const list = isObj(raw.senders) ? Object.entries(raw.senders) : [];
  if (list.length > MAIL_SENDERS_MAX) return `发件人设置最多 ${MAIL_SENDERS_MAX} 条`;
  for (const [k, v] of list) {
    const key = k.trim().toLowerCase();
    if (!key || key.length > MAX_KEY || !key.includes(".") || !isObj(v)) return `发件人设置不合法: ${k}`;
    const pref: MailSenderPref = {};
    if (has(v, "images", MAIL_IMAGES)) pref.images = v.images as MailImages;
    if (has(v, "style", MAIL_STYLES)) pref.style = v.style as MailStyle;
    if (pref.images || pref.style) senders[key] = pref;
  }
  return { images: raw.images as MailImagePolicy, senders };
}

/** 规则是否命中这封信。 */
export function ruleMatches(r: MailRule, mail: MailInfo, subject: string): boolean {
  if (!r.on) return false;
  const conds = [r.from, r.domain, r.category, r.subject, r.to].filter(Boolean);
  if (!conds.length) return false;
  const d = domainOf(mail.from);
  if (r.from && mail.from !== r.from) return false;
  if (r.domain && d !== r.domain && !d.endsWith(`.${r.domain}`)) return false;
  if (r.category && mail.category !== r.category) return false;
  if (r.subject && !subject.toLowerCase().includes(r.subject.toLowerCase())) return false;
  if (r.to && mail.to !== r.to && mail.rcpt !== r.to) return false;
  return true;
}

const optStr = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export function parseMailRules(raw: unknown): MailRule[] | string {
  if (!isObj(raw) || !Array.isArray(raw.rules)) return "需要 { rules: [...] }";
  if (raw.rules.length > MAIL_RULES_MAX) return `规则最多 ${MAIL_RULES_MAX} 条`;
  const out: MailRule[] = [];
  for (const [i, r] of raw.rules.entries()) {
    const n = `第 ${i + 1} 条`;
    if (!isObj(r)) return `${n}: 需要对象`;
    const channel = optStr(r.channel, MAX_ID_LENGTH);
    if (!channel) return `${n}: 需要 channel`;
    const rule: MailRule = { id: optStr(r.id, MAX_ID_LENGTH) ?? `r${Date.now().toString(36)}${i}`, on: r.on !== false, channel, keep: r.keep !== false };
    const from = optStr(r.from, MAX_KEY)?.toLowerCase();
    const domain = optStr(r.domain, MAX_KEY)?.toLowerCase();
    const to = optStr(r.to, MAX_KEY)?.toLowerCase();
    const subject = optStr(r.subject, 100);
    const category = optStr(r.category, 20);
    if (from) rule.from = from;
    if (domain) rule.domain = domain;
    if (to) rule.to = to;
    if (subject) rule.subject = subject;
    if (category) rule.category = category as MailCategory;
    if (!from && !domain && !to && !subject && !category) return `${n}: 至少要一个条件`;
    out.push(rule);
  }
  return out;
}
