import { API_V1 } from "./constants";
import type { Envelope } from "./event";

// 邮件聚合: 每封信是邮件群里的一条事件, 额外带 data.mail; 厂商 / 账号筛选走服务端索引
export const MAIL_CHANNEL = "mail";
export const MAIL_TITLE = "邮件";
export const MAIL_SOURCE_PREFIX = "mail:";
export const MAIL_VIAS = ["cf", "hx-email", "api"] as const;
export type MailVia = (typeof MAIL_VIAS)[number];

// 群的展示方式: 默认聊天气泡, mail 为邮件列表 (带筛选)
export const CHAT_VIEWS = ["chat", "mail"] as const;
export type ChatView = (typeof CHAT_VIEWS)[number];

/**
 * 随事件保存的邮件信息。to 为收件账号 (转发时是原收件地址)。
 * body: 有完整正文可取 (GET /mail/{id}/body), html 为原版网页, text 为长纯文本。
 * spoof: 发件域名的 DMARC 校验失败, 可能是冒充。
 */
export type MailInfo = { from: string; name?: string; to: string; vendor: string; code?: string; via: MailVia; body?: MailBodyKind; spoof?: boolean };
export type MailBodyKind = "html" | "text";
/** GET /mail/{id}/body: 统一给 HTML (纯文本已转成可显示的 HTML)。 */
export type MailBody = { html: string };

/** 外部推送一封信 (POST /mail)。text 与 html 至少一个。 */
export type MailInput = { from: string; name?: string; to: string; subject?: string; text?: string; html?: string; code?: string; messageId?: string; ts?: number; spoof?: boolean };

export type MailList = { messages: Envelope[]; more: boolean };
export type MailFacet = { key: string; count: number; last: number };
export type MailFacets = { vendors: MailFacet[]; accounts: MailFacet[] };

export const PATH_MAIL = `${API_V1}/mail`;
export const PATH_MAIL_FACETS = `${API_V1}/mail/facets`;
export const PATH_MAIL_HX_EMAIL = `${API_V1}/mail/hx-email`;
export const PATH_MAIL_BODY = `${API_V1}/mail/{id}/body`;
export const QUERY_VENDOR = "vendor";
export const QUERY_ACCOUNT = "account";
// 关键词: 匹配主题与发件地址
export const QUERY_MAIL_SEARCH = "q";
export const MAIL_SEARCH_MAX = 64;
export const MAIL_PAGE_DEFAULT = 50;
export const MAIL_PAGE_MAX = 200;
const MAX_ADDR = 320;
const MAX_SUBJECT = 300;
export const MAX_MAIL_TEXT = 200_000;
// CF 路由收到的原版 HTML 存 R2, 上限放宽到 2MB
export const MAX_MAIL_HTML = 2 * 1024 * 1024;

// 发件域名 -> 厂商名; 子域名也算 (mail.github.com -> GitHub)
const VENDORS: Record<string, string> = {
  "openai.com": "GPT",
  "chatgpt.com": "GPT",
  "anthropic.com": "Claude",
  "github.com": "GitHub",
  "gitlab.com": "GitLab",
  "google.com": "Google",
  "youtube.com": "YouTube",
  "microsoft.com": "Microsoft",
  "outlook.com": "Microsoft",
  "live.com": "Microsoft",
  "apple.com": "Apple",
  "icloud.com": "Apple",
  "cloudflare.com": "Cloudflare",
  "amazon.com": "Amazon",
  "aws.amazon.com": "AWS",
  "x.com": "X",
  "twitter.com": "X",
  "discord.com": "Discord",
  "telegram.org": "Telegram",
  "steampowered.com": "Steam",
  "bilibili.com": "B站",
  "qq.com": "QQ",
  "tencent.com": "腾讯",
  "alipay.com": "支付宝",
  "aliyun.com": "阿里云",
  "jetbrains.com": "JetBrains",
  "vercel.com": "Vercel",
  "npmjs.com": "npm",
  "docker.com": "Docker",
  "linear.app": "Linear",
  "notion.so": "Notion",
  "figma.com": "Figma",
  "stripe.com": "Stripe",
  "paypal.com": "PayPal",
};

export function domainOf(addr: string): string {
  const at = addr.lastIndexOf("@");
  return (at >= 0 ? addr.slice(at + 1) : addr).trim().toLowerCase().replace(/[>\s].*$/, "");
}

/** 认识的厂商给名字, 不认识的用主域名 (a.b.example.com -> example.com)。 */
export function vendorOf(addr: string): string {
  const d = domainOf(addr);
  for (let cur = d; cur.includes("."); cur = cur.slice(cur.indexOf(".") + 1)) {
    const v = VENDORS[cur];
    if (v) return v;
  }
  const parts = d.split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : d || "未知";
}

const CODE_HINT = /(验证码|校验码|动态码|code|otp|verification|verify|passcode|一次性)/i;
const CODE_RE = /(?<![\w-])([A-Z0-9]{4,8})(?![\w-])/g;

/** 只在出现 "验证码 / code" 字样时取码: 优先纯数字, 再取含数字的大写串。 */
export function extractCode(subject: string, text: string): string | undefined {
  const hay = `${subject}\n${text.slice(0, 4000)}`;
  if (!CODE_HINT.test(hay)) return undefined;
  const hits = [...hay.matchAll(CODE_RE)].map((m) => m[1] ?? "").filter((s) => /\d/.test(s));
  return hits.find((s) => /^\d{4,8}$/.test(s)) ?? hits.find((s) => /^[A-Z0-9]{6,8}$/.test(s));
}

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export function parseMailInput(raw: unknown): { ok: true; value: MailInput } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "需要 JSON 对象" };
  const r = raw as Record<string, unknown>;
  if (!isStr(r.from, MAX_ADDR)) return { ok: false, error: "需要 from" };
  if (!isStr(r.to, MAX_ADDR)) return { ok: false, error: "需要 to (收件账号)" };
  const out: MailInput = { from: r.from, to: r.to };
  if (isStr(r.name, MAX_ADDR)) out.name = r.name;
  if (isStr(r.subject, MAX_SUBJECT)) out.subject = r.subject;
  if (isStr(r.text, MAX_MAIL_TEXT)) out.text = r.text;
  if (isStr(r.html, MAX_MAIL_TEXT)) out.html = r.html;
  if (isStr(r.code, 32)) out.code = r.code;
  if (isStr(r.messageId, MAX_ADDR)) out.messageId = r.messageId;
  if (typeof r.ts === "number" && Number.isFinite(r.ts)) out.ts = r.ts;
  if (!out.text && !out.html && !out.subject) return { ok: false, error: "subject / text / html 至少一个" };
  return { ok: true, value: out };
}
