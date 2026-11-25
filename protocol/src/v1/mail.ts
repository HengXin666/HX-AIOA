import { API_V1 } from "./constants";
import type { Envelope } from "./event";

// 邮件聚合: 每封信是邮件群里的一条事件, 额外带 data.mail; 厂商 / 账号筛选走服务端索引
export const MAIL_CHANNEL = "mail";
export const MAIL_TITLE = "邮件";
export const MAIL_SOURCE_PREFIX = "mail:";
export const MAIL_VIAS = ["cf", "hx-email", "api"] as const;
export type MailVia = (typeof MAIL_VIAS)[number];

// 群的展示方式: 默认聊天气泡, mail 为邮件列表 (带筛选)
// feed: 信息流 (统一推送卡片按条目平铺), 主人可在群设置里切换; mail 只由服务端设置
export const CHAT_VIEWS = ["chat", "mail", "feed"] as const;
export type ChatView = (typeof CHAT_VIEWS)[number];

/**
 * 随事件保存的邮件信息。to 为收件账号: 真正收信的地址 (转发时是原收件地址), 旧信认不出时为空串。
 * rcpt: CF 实际投递的地址; list: 信头 To 里的中转地址 (如 repo@noreply.github.com), 显示为 "经 ..."。
 * body: 有完整正文可取 (GET /mail/{id}/body), html 为原版网页, text 为长纯文本。
 * spoof: 发件域名的 DMARC 校验失败, 可能是冒充。
 */
export type MailInfo = { from: string; name?: string; to: string; rcpt?: string; list?: string; vendor: string; category?: MailCategory; code?: string; via: MailVia; body?: MailBodyKind; spoof?: boolean };
export type MailBodyKind = "html" | "text";
/** GET /mail/{id}/body: 统一给 HTML (纯文本已转成可显示的 HTML)。 */
export type MailBody = { html: string };

/** 外部推送一封信 (POST /mail)。text 与 html 至少一个。 */
export type MailInput = { from: string; name?: string; to: string; rcpt?: string; list?: string; subject?: string; text?: string; html?: string; code?: string; messageId?: string; ts?: number; spoof?: boolean };

export type MailList = { messages: Envelope[]; more: boolean };
/** from: 该组最新一封的发件地址, 客户端据此取头像。 */
export type MailFacet = { key: string; count: number; last: number; from?: string };
export type MailFacets = { vendors: MailFacet[]; accounts: MailFacet[]; categories: MailFacet[] };

export const PATH_MAIL = `${API_V1}/mail`;
export const PATH_MAIL_FACETS = `${API_V1}/mail/facets`;
export const PATH_MAIL_HX_EMAIL = `${API_V1}/mail/hx-email`;
export const PATH_MAIL_BODY = `${API_V1}/mail/{id}/body`;
/** 发件方网站图标 (按主域名代理并缓存), 404 表示没有, 客户端用首字母。 */
export const PATH_MAIL_ICON = `${API_V1}/mail/icon/{domain}`;
/** 认不出收件账号 (旧信没存投递地址) 时的账号值。 */
export const MAIL_ACCOUNT_UNKNOWN = "";
export const QUERY_VENDOR = "vendor";
export const QUERY_ACCOUNT = "account";
export const QUERY_CATEGORY = "category";
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

// 分类: 先查厂商表, 认不出的按域名里的关键词猜, 再不行归 "其他"
export const MAIL_CATEGORIES = ["AI", "开发", "云服务", "账号安全", "金融", "购物", "社交", "影音", "游戏", "办公", "教育", "政务", "其他"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];
export const MAIL_CATEGORY_OTHER: MailCategory = "其他";

// 发件域名 -> [厂商名, 分类]; 子域名也算 (mail.github.com -> GitHub)
const VENDORS: Record<string, [string, MailCategory]> = {
  "openai.com": ["GPT", "AI"],
  "chatgpt.com": ["GPT", "AI"],
  "anthropic.com": ["Claude", "AI"],
  "github.com": ["GitHub", "开发"],
  "gitlab.com": ["GitLab", "开发"],
  "google.com": ["Google", "账号安全"],
  "youtube.com": ["YouTube", "影音"],
  "microsoft.com": ["Microsoft", "账号安全"],
  "outlook.com": ["Microsoft", "账号安全"],
  "live.com": ["Microsoft", "账号安全"],
  "apple.com": ["Apple", "账号安全"],
  "icloud.com": ["Apple", "账号安全"],
  "cloudflare.com": ["Cloudflare", "云服务"],
  "amazon.com": ["Amazon", "购物"],
  "aws.amazon.com": ["AWS", "云服务"],
  "x.com": ["X", "社交"],
  "twitter.com": ["X", "社交"],
  "discord.com": ["Discord", "社交"],
  "telegram.org": ["Telegram", "社交"],
  "steampowered.com": ["Steam", "游戏"],
  "bilibili.com": ["B站", "影音"],
  "qq.com": ["QQ", "社交"],
  "tencent.com": ["腾讯", "社交"],
  "alipay.com": ["支付宝", "金融"],
  "aliyun.com": ["阿里云", "云服务"],
  "jetbrains.com": ["JetBrains", "开发"],
  "vercel.com": ["Vercel", "云服务"],
  "npmjs.com": ["npm", "开发"],
  "docker.com": ["Docker", "开发"],
  "linear.app": ["Linear", "办公"],
  "notion.so": ["Notion", "办公"],
  "figma.com": ["Figma", "办公"],
  "stripe.com": ["Stripe", "金融"],
  "paypal.com": ["PayPal", "金融"],
  "huggingface.co": ["Hugging Face", "AI"],
  "deepseek.com": ["DeepSeek", "AI"],
  "x.ai": ["Grok", "AI"],
  "gemini.google.com": ["Gemini", "AI"],
  "netlify.com": ["Netlify", "云服务"],
  "digitalocean.com": ["DigitalOcean", "云服务"],
  "oracle.com": ["Oracle", "云服务"],
  "epicgames.com": ["Epic", "游戏"],
  "netflix.com": ["Netflix", "影音"],
  "spotify.com": ["Spotify", "影音"],
  "slack.com": ["Slack", "办公"],
  "zoom.us": ["Zoom", "办公"],
  "taobao.com": ["淘宝", "购物"],
  "jd.com": ["京东", "购物"],
  "wise.com": ["Wise", "金融"],
  "stackoverflow.com": ["Stack Overflow", "开发"],
  "pypi.org": ["PyPI", "开发"],
};

// 不认识的域名: 按关键词猜分类, 顺序即优先级; 关键词须在域名段开头 (避免 display 命中 play)
const seg = (words: string) => new RegExp(`(^|[.-])(${words})`);
const GUESS: [RegExp, MailCategory][] = [
  [/(^|\.)(edu|ac)(\.[a-z]{2})?$/, "教育"],
  [seg("universit|school|college"), "教育"],
  [/(^|\.)gov(\.[a-z]{2})?$/, "政务"],
  [seg("bank|pay|card|financ|invest|insur|wallet"), "金融"],
  [seg("shop|store|mall|order|deliver|express"), "购物"],
  [seg("game|play|esport"), "游戏"],
  [seg("cloud|host|vps|cdn|dns"), "云服务"],
  [/(^|[.-])ai[.-]|\.ai$/, "AI"],
  [seg("git|dev|code|api"), "开发"],
  [seg("music|video|tv|movie|news"), "影音"],
];

export function domainOf(addr: string): string {
  const at = addr.lastIndexOf("@");
  return (at >= 0 ? addr.slice(at + 1) : addr).trim().toLowerCase().replace(/[>\s].*$/, "");
}

const known = (domain: string): [string, MailCategory] | undefined => {
  for (let cur = domain; cur.includes("."); cur = cur.slice(cur.indexOf(".") + 1)) {
    const v = VENDORS[cur];
    if (v) return v;
  }
  return undefined;
};

// 中转 / 不回信地址: 不是真实收件人, 不能当账号
const RELAY_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|reply(\+.*)?|bounces?)$/;
const RELAY_DOMAIN = /(^|\.)(noreply|no-reply|reply|bounces?)\./;

/** 中转地址: GitHub 的 repo@noreply.github.com, 各家 noreply / notifications / reply+xxx 之类。 */
export function isRelayAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase();
  const at = a.lastIndexOf("@");
  if (at < 0) return false;
  return RELAY_LOCAL.test(a.slice(0, at)) || RELAY_DOMAIN.test(`${a.slice(at + 1)}.`);
}

/** 主域名: a.b.example.com -> example.com, 两段式国家后缀保留三段 (x.com.cn)。 */
export function siteOf(addr: string): string {
  const parts = domainOf(addr).split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const sld = parts[parts.length - 2] ?? "";
  const n = parts[parts.length - 1]!.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return parts.slice(-n).join(".");
}
const SECOND_LEVEL = new Set(["com", "net", "org", "gov", "edu", "ac", "co"]);

/** 白名单域名 (分类表的键), 客户端按它判断能否放行远程图片。 */
export const knownSenderDomains = (): string[] => Object.keys(VENDORS);

/** 白名单: 分类表里认识的厂商域名 (含子域名)。 */
export const isKnownSender = (addr: string): boolean => known(domainOf(addr)) !== undefined;

/** 认识的厂商给名字, 不认识的用主域名 (a.b.example.com -> example.com)。 */
export function vendorOf(addr: string): string {
  const d = domainOf(addr);
  const v = known(d);
  if (v) return v[0];
  const parts = d.split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : d || "未知";
}

/** 按发件域名自动分类。 */
export function categoryOf(addr: string): MailCategory {
  const d = domainOf(addr);
  return known(d)?.[1] ?? GUESS.find(([re]) => re.test(d))?.[1] ?? MAIL_CATEGORY_OTHER;
}

// 英文词按整词匹配 (避免 Unicode / barcode); 码只在提示词后面不远处找 (避免资讯信里的年份 "2026")
const CODE_HINT = /(验证码|校验码|动态码|一次性|\b(?:code|otp|verification|verify|passcode)\b)/gi;
const CODE_RE = /(?<![\w-])([A-Z0-9]{4,8})(?![\w-])/g;
const CODE_NEAR = 60;
const YEAR = /^(19|20)\d{2}$/;

/** 只取 "验证码 / code" 字样附近 (先看后 60 字, 再看前 30 字, 中间不隔句读) 的码: 优先纯数字 (年份除外), 再取含数字的大写串。 */
export function extractCode(subject: string, text: string): string | undefined {
  const hay = `${subject}\n${text.slice(0, 4000)}`;
  const hints = [...hay.matchAll(CODE_HINT)];
  for (const h of hints) {
    const start = (h.index ?? 0) + h[0].length;
    const code = pick(hay.slice(start, start + CODE_NEAR), false);
    if (code) return code;
  }
  // "123456 是你的验证码": 提示词前面紧挨着的
  for (const h of hints) {
    const end = h.index ?? 0;
    const code = pick(hay.slice(Math.max(0, end - CODE_NEAR / 2), end), true);
    if (code) return code;
  }
  return undefined;
}

// 提示词与码之间不能隔着句读 ("write code, win 25000" 不算)
const BREAK = /[,.;!?，。；！？]/;

function pick(near: string, before: boolean): string | undefined {
  const hits = [...near.matchAll(CODE_RE)]
    .filter((m) => {
      const at = m.index ?? 0;
      const gap = before ? near.slice(at + m[0].length) : near.slice(0, at);
      return !BREAK.test(gap);
    })
    .map((m) => m[1] ?? "")
    .filter((s) => /\d/.test(s) && !YEAR.test(s));
  if (before) hits.reverse();
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
  if (isStr(r.rcpt, MAX_ADDR)) out.rcpt = r.rcpt;
  if (isStr(r.list, MAX_ADDR)) out.list = r.list;
  if (isStr(r.subject, MAX_SUBJECT)) out.subject = r.subject;
  if (isStr(r.text, MAX_MAIL_TEXT)) out.text = r.text;
  if (isStr(r.html, MAX_MAIL_TEXT)) out.html = r.html;
  if (isStr(r.code, 32)) out.code = r.code;
  if (isStr(r.messageId, MAX_ADDR)) out.messageId = r.messageId;
  if (typeof r.ts === "number" && Number.isFinite(r.ts)) out.ts = r.ts;
  if (!out.text && !out.html && !out.subject) return { ok: false, error: "subject / text / html 至少一个" };
  return { ok: true, value: out };
}
