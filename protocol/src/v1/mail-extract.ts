// 邮件关键信息 (#146): 验证码与有效期, 关键链接, 按内容分类与要点。安卓 MailExtract.kt 同规则移植。
import { isKnownSender, siteOf, type MailFact, type MailKind, type MailLink, type MailOtp } from "./mail";
import { mailText, type MailAnchor } from "./mail-clean";

/** 一封信的精简结果: body 干净正文, brief 两行以内的要点 (验证码信不做摘要)。 */
export type MailDigest = { body: string; brief: string; kind: MailKind; otp?: MailOtp; links: MailLink[]; facts: MailFact[] };
export type MailDigestInput = { subject: string; from: string; name?: string; html?: string; text?: string; ts?: number; code?: string };

export const MAX_MAIL_BODY = 20_000;
export const MAX_MAIL_BRIEF = 120;
const MAX_LINKS = 3;
const MAX_LABEL = 40;
const HAY_MAX = 4000;
const NEAR_AFTER = 60;
const NEAR_BEFORE = 30;
const BRIEF_ENOUGH = 30;
const MIN_LINE = 4;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

// 强提示词直接认; 弱提示词 ("your code", "code:") 要主题或开头像登录验证才认
const OTP_STRONG = new RegExp(
  "(验证码|校验码|动态码|动态密码|确认码|安全码|登录码|激活码|一次性(?:密码|验证码|代码)|verification code|security code|confirmation code|" +
    "log[- ]?in code|sign[- ]?in code|access code|one[- ]time (?:pass)?code|one[- ]time password|\\botp\\b|\\bpasscode\\b|\\b2fa code\\b)",
  "gi",
);
const OTP_WEAK = /(\b(?:your|the|this|following|enter|use)\s+code\b|\bcode\s*(?:is\b|:|：))/gi;
const VERIFY_HINT = /verif|sign[- ]?in|log[- ]?in|登录|验证|确认|confirm|authenticat|2fa|otp|security|安全|password|密码/i;
const CODE_RE = /(?<![\w\-/:.@#])(\d{3}[ -]\d{3}|[A-Z0-9]{4,8})(?![\w\-/:%@]|\.\d)/g;
const YEAR = /^(19|20)\d{2}$/;
const AFTER_UNIT = /^\s*(元|块|%|usd|cny|rmb|美元|分钟|分|min|秒|小时|天|days?|hours?|minutes?|items?|项|条|个|次|人|积分|points?|行|字|kb|mb|gb)/i;
const BEFORE_NOISE = /([¥￥$€£]|usd|cny|rmb|金额|订单号?|单号|order|#|no\.|tel|phone|电话|手机|版本|version|v)\s*[:：#]?\s*$/i;
// 提示词与码之间不能隔着句读; 句号紧跟换行不算 ("code is below.\n123456")
const BREAK = /[,;!?，；！？]|[.。](?!\s*\n)/;
const EXPIRES: RegExp[] = [
  /(\d{1,3})\s*(分钟|分|小时|min(?:ute)?s?|hours?|hrs?)\s*(?:内|之内)?\s*(?:有效|过期|失效)/i,
  /(?:有效期|有效时间)\s*(?:为|是)?\s*[:：]?\s*(\d{1,3})\s*(分钟|分|小时)/,
  /(?:valid|expires?|expiring|active)\s*(?:for|in|within|after)?\s*(?:the\s+next\s+)?(\d{1,3})\s*(min(?:ute)?s?|hours?|hrs?)/i,
];
const HOUR_UNIT = /小时|hour|hr/i;
const ACTION = /(登录|登入|确认|验证|激活|重置|找回|接受邀请|sign[- ]?in|log[- ]?in|verify|confirm|activate|reset|magic link|accept invit)/i;
const GREETING = /^((hi|hello|hey|dear|greetings)\b.{0,30}|(您好|你好|亲爱的|尊敬的).{0,20})[,，!！:：]?$/i;
const GH_REPO = /^\s*(?:(?:re|fwd?)\s*:\s*)*\[([\w.-]+\/[\w.-]+)\]/i;
const BILL = /(账单|收据|发票|付款成功|支付成功|扣款|消费提醒|已支付|receipt|invoice|payment (?:received|confirmation|successful)|order confirmation|you(?:'ve| have) been charged|billing statement)/i;
const AMOUNT = /(?:[¥￥$€£]|US\$|HK\$|USD|CNY|RMB)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s?(?:元|USD|CNY|RMB)/i;
const TOTAL = /(合计|总计|实付|应付|支付金额|金额|total|amount|paid|charged)/i;
const SHIP_NO = /(运单号|快递单号|物流单号|tracking (?:number|no\.?|#|id))\s*[:：#]?\s*([A-Z0-9]{8,30})/i;
const SHIP_STATUS = /(已签收|派送中|运输中|已发货|已揽收|待取件|delivered|out for delivery|in transit|shipped|ready for pickup)/i;
const ALERT = /(故障|恢复|告警|报警|异常|安全|incident|outage|degraded|resolved|alert|security|failed|error)/i;
const PROMO = /(sale|% off|discount|deal|coupon|promo|优惠|促销|折扣|限时|特价|满减|black friday|cyber monday|newsletter|webinar|hackathon|beta|launch|new feature|新品|上新|活动)/i;

/** 码的前后不是金额, 单位, 订单号, 版本号。 */
function plausible(hay: string, at: number, code: string): boolean {
  if (!/\d/.test(code) || YEAR.test(code)) return false;
  if (AFTER_UNIT.test(hay.slice(at + code.length, at + code.length + 6))) return false;
  return !BEFORE_NOISE.test(hay.slice(Math.max(0, at - 12), at));
}

function pick(hay: string, from: number, to: number, before: boolean): string | undefined {
  const near = hay.slice(from, to);
  const hits: string[] = [];
  for (const m of near.matchAll(CODE_RE)) {
    const at = m.index ?? 0;
    const gap = before ? near.slice(at + m[0].length) : near.slice(0, at);
    if (BREAK.test(gap) || !plausible(hay, from + at, m[1] ?? "")) continue;
    hits.push((m[1] ?? "").replace(/[ -]/g, ""));
  }
  if (before) hits.reverse();
  return hits.find((s) => /^\d{4,8}$/.test(s)) ?? hits.find((s) => /^(?=.*[A-Z])[A-Z0-9]{6,8}$/.test(s));
}

/** 只取 "验证码 / verification code" 附近 (先后 60 字, 再前 30 字) 的码: 优先纯数字, 再取含数字的大写串。 */
export function extractCode(subject: string, text: string): string | undefined {
  const hay = `${subject}\n${text.slice(0, HAY_MAX)}`;
  const hints = [...hay.matchAll(OTP_STRONG)];
  if (VERIFY_HINT.test(hay.slice(0, subject.length + 300))) hints.push(...hay.matchAll(OTP_WEAK));
  for (const h of hints) {
    const start = (h.index ?? 0) + h[0].length;
    const code = pick(hay, start, start + NEAR_AFTER, false);
    if (code) return code;
  }
  for (const h of hints) {
    const end = h.index ?? 0;
    const code = pick(hay, Math.max(0, end - NEAR_BEFORE), end, true);
    if (code) return code;
  }
  return undefined;
}

/** 有效期: "10 分钟内有效", "valid for 15 minutes"; 没写返回 undefined。 */
export function expiresIn(text: string): number | undefined {
  for (const re of EXPIRES) {
    const m = re.exec(text);
    if (m) return Number(m[1]) * (HOUR_UNIT.test(m[2] ?? "") ? HOUR_MS : MINUTE_MS);
  }
  return undefined;
}

function actionLinks(anchors: MailAnchor[]): MailLink[] {
  const out: MailLink[] = [];
  for (const a of anchors) {
    if (a.label.length > MAX_LABEL || !ACTION.test(a.label) || out.some((x) => x.url === a.url)) continue;
    out.push({ label: a.label, url: a.url });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 要点: 跳过问候语, 与主题重复的行, 太短的行; 第一段不够长就接上下一段。 */
export function briefOf(body: string, subject: string): string {
  const subj = norm(subject);
  const parts: string[] = [];
  for (const l of body.split("\n")) {
    const n = norm(l);
    if (l.length < MIN_LINE || GREETING.test(l) || (n.length > 0 && subj.includes(n))) continue;
    parts.push(l);
    if (parts.join(" · ").length >= BRIEF_ENOUGH) break;
  }
  const s = parts.join(" · ");
  return s.length > MAX_MAIL_BRIEF ? `${s.slice(0, MAX_MAIL_BRIEF - 1)}…` : s;
}

function kindOf(i: MailDigestInput, body: string, otp: boolean, unsub: boolean): [MailKind, MailFact[]] {
  if (otp) return ["otp", []];
  const repo = GH_REPO.exec(i.subject)?.[1];
  if (siteOf(i.from) === "github.com") return ["github", repo ? [{ label: "仓库", value: repo }] : []];
  const hay = `${i.subject}\n${body.slice(0, HAY_MAX)}`;
  const no = SHIP_NO.exec(hay);
  if (no) {
    const st = SHIP_STATUS.exec(hay)?.[1];
    return ["shipping", [{ label: "单号", value: no[2] ?? "" }, ...(st ? [{ label: "状态", value: st }] : [])]];
  }
  if (BILL.test(hay)) {
    const t = TOTAL.exec(hay);
    const amount = (t ? AMOUNT.exec(hay.slice(t.index)) : null) ?? AMOUNT.exec(hay);
    if (amount) return ["bill", [{ label: "金额", value: amount[0].trim() }, { label: "商家", value: i.name?.trim() || siteOf(i.from) }]];
  }
  if (unsub && !ALERT.test(i.subject) && (PROMO.test(hay) || !isKnownSender(i.from))) return ["marketing", []];
  return ["normal", []];
}

/** 收信时跑一次: 正文去噪, 验证码与有效期, 关键链接, 类型与要点。code 为推送方已经认出的验证码。 */
export function digestMail(i: MailDigestInput): MailDigest {
  const t = mailText(i.html, i.text);
  const body = t.text.slice(0, MAX_MAIL_BODY);
  const code = i.code?.trim() || extractCode(i.subject, body);
  let otp: MailOtp | undefined;
  if (code) {
    otp = { code };
    const ttl = expiresIn(`${i.subject}\n${body.slice(0, HAY_MAX)}`);
    if (ttl && i.ts) otp.expiresAt = i.ts + ttl;
  }
  const [kind, facts] = kindOf(i, body, !!otp, t.unsub);
  const d: MailDigest = { body, brief: otp ? "" : briefOf(body, i.subject), kind, links: actionLinks(t.anchors), facts };
  if (otp) d.otp = otp;
  return d;
}
