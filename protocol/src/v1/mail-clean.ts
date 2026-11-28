// 邮件精简正文 (#146): HTML 转文本, 去隐藏元素与追踪像素, 去引用历史, 签名, 页脚。
// 安卓 MailClean.kt 按同一套规则移植, 改这里要同步改那里 (快照测试共用 protocol/fixtures/mail)。

/** 一个链接: 文字与地址。 */
export type MailAnchor = { label: string; url: string };
/** 转换结果: 文本 (一行一段), 链接, 是否有退订入口。 */
export type MailText = { text: string; anchors: MailAnchor[]; unsub: boolean };

const RAW_BLOCKS = /<(style|script|head|title|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const DECL = /<![^>]*>/g;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const VOID = new Set(["br", "img", "hr", "meta", "link", "input", "wbr", "source", "col", "area", "base", "embed", "param", "track"]);
const BLOCK = new Set([
  "p", "div", "br", "li", "tr", "td", "th", "table", "ul", "ol", "blockquote", "section", "article", "header", "footer", "hr", "center",
  "pre", "dt", "dd", "details", "summary", "address", "figure", "figcaption", "form", "h1", "h2", "h3", "h4", "h5", "h6",
]);
// 隐藏元素: 预览文字 (preheader), GitHub 的 Message-ID 之类; font-size:0 常用于排版, 不算隐藏
const HIDDEN = /display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all/i;
const SHRUNK = /max-height\s*:\s*0(?![.\d])/i;
const CLIP = /overflow\s*:\s*hidden/i;
// 引用的历史邮件: Gmail / Yahoo / Apple 的引用块, Outlook 回复分隔块 (之后整段都是历史)
const QUOTE_ATTR = /\btype\s*=\s*["']?cite|gmail_quote|yahoo_quoted|protonmail_quote/i;
const OUTLOOK_CUT = /divRplyFwdMsg|id\s*=\s*["']?(?:appendonsend|mail-editor-reference-message-container)/i;
const BARE_HIDDEN = /(^|\s)hidden(\s|=|$)/i;
const STYLE_ATTR = /\bstyle\s*=\s*("[^"]*"|'[^']*')/i;
const HREF_ATTR = /\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i;
export const UNSUB = /unsubscribe|退订|取消订阅|opt[- ]?out/i;
const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u206a-\u206f\u3164\ufeff\uffa0]/g;
const SPACES = /[ \t\r\n\f\u00a0\u3000]+/g;
const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", trade: "™",
  middot: "·", bull: "•", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", yen: "¥", euro: "€", pound: "£", zwnj: "", zwj: "", shy: "",
  ensp: " ", emsp: " ", thinsp: " ", laquo: "«", raquo: "»", times: "×", rarr: "→", larr: "←",
};
const MAX_CODE_POINT = 0x10ffff;

export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] !== "#") return NAMED[e.toLowerCase()] ?? m;
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= MAX_CODE_POINT ? String.fromCodePoint(cp) : "";
  });
}

const attrOf = (re: RegExp, attrs: string): string => {
  const v = re.exec(attrs)?.[1] ?? "";
  return v.startsWith("\"") || v.startsWith("'") ? v.slice(1, -1) : v;
};

function hiddenTag(attrs: string): boolean {
  const style = attrOf(STYLE_ATTR, attrs);
  return HIDDEN.test(style) || (SHRUNK.test(style) && CLIP.test(style)) || QUOTE_ATTR.test(attrs) || BARE_HIDDEN.test(attrs.replace(STYLE_ATTR, ""));
}

/** HTML 转文本: 块级元素换行, 列表项前加 "- ", 隐藏元素与引用块整段跳过, 图片丢掉, 链接只留文字并单独收集。 */
export function htmlText(html: string): MailText {
  const src = html.replace(COMMENT, "").replace(DECL, "").replace(RAW_BLOCKS, "");
  const stack: string[] = [];
  const anchors: MailAnchor[] = [];
  let out = "";
  let skipAt = -1;
  let unsub = false;
  let link: { url: string; at: number } | null = null;
  let last = 0;
  // <pre> 里保留换行 (纯文本信转成的网页就是一整段 pre)
  const emit = (raw: string) => {
    if (skipAt >= 0 || !raw) return;
    const t = decodeEntities(raw).replace(INVISIBLE, "");
    out += stack.includes("pre") ? t.replace(/\r\n?/g, "\n") : t.replace(SPACES, " ");
  };
  TAG.lastIndex = 0;
  for (let m = TAG.exec(src); m; m = TAG.exec(src)) {
    emit(src.slice(last, m.index));
    last = TAG.lastIndex;
    const close = m[1] === "/";
    const name = (m[2] ?? "").toLowerCase();
    const attrs = m[3] ?? "";
    if (!close && OUTLOOK_CUT.test(attrs)) {
      last = src.length;
      break;
    }
    if (close) {
      const i = stack.lastIndexOf(name);
      if (i < 0) continue;
      stack.length = i;
      if (skipAt >= 0 && stack.length <= skipAt) { skipAt = -1; continue; }
      if (skipAt >= 0) continue;
      if (name === "a" && link) {
        const label = out.slice(link.at).replace(SPACES, " ").trim();
        if (UNSUB.test(label) || UNSUB.test(link.url)) unsub = true;
        else if (/^https?:/i.test(link.url) && label) anchors.push({ label, url: link.url });
        link = null;
      }
      if (BLOCK.has(name)) out += "\n";
      continue;
    }
    const selfClose = VOID.has(name) || attrs.trimEnd().endsWith("/");
    if (skipAt < 0 && hiddenTag(attrs) && !selfClose) {
      skipAt = stack.length;
      stack.push(name);
      continue;
    }
    if (!selfClose) stack.push(name);
    if (skipAt >= 0) continue;
    if (name === "a") link = { url: decodeEntities(attrOf(HREF_ATTR, attrs)).trim(), at: out.length };
    if (BLOCK.has(name)) out += "\n";
    if (name === "li") out += "- ";
  }
  emit(src.slice(last));
  return { text: out, anchors, unsub };
}

// 引用历史的开头: "On ... wrote:", "在 ... 写道:", 原始邮件 / 转发分隔线, Outlook 的 "发件人: ... 发送时间: ..."
const WROTE = /(wrote|schrieb|a écrit|escribió)\s*:\s*$/i;
const WROTE_HEAD = /^(on|am|le|el)\s/i;
const CN_WROTE = /写道\s*[:：]?\s*$/;
const ORIGINAL = /^[-_=]{2,}\s*(original message|forwarded message|原始邮件|转发邮件|转发的邮件|原邮件)\s*[-_=]{2,}$/i;
const OUTLOOK_FROM = /^(from|发件人)\s*[:：]/i;
const OUTLOOK_META = /^(sent|date|to|subject|发送时间|日期|时间|收件人|主题)\s*[:：]/i;
const SIGNATURE = new Set(["--", "—", "——", "__", "-- "]);
// 页脚: 强标记出现在后半段就从那里截掉; 弱标记只在后半段逐行去掉
const FOOT_STRONG = new RegExp(
  "unsubscribe|退订|取消订阅|you('re| are) receiving this|you received this (email|message)|(此|本)邮件(由|为)系统自动发送|系统自动发送|请勿直接回复|" +
    "do not reply to this (email|message)|manage (your )?(email |notification )?(preferences|notifications|subscriptions)|notification settings|" +
    "通知设置|reply to this email directly|view (this email |it )?in (your |a )?browser|在浏览器中(查看|打开)",
  "i",
);
const FOOT_WEAK = new RegExp(
  "privacy policy|隐私政策|隐私条款|terms of (service|use)|服务条款|用户协议|all rights reserved|版权所有|copyright|^©|©\\s*\\d{4}|\\(c\\)\\s*\\d{4}|" +
    "^powered by|github, inc\\.|\\b(street|avenue|road|suite|blvd)\\b.*\\d|\\d.*\\b(street|avenue|road|suite|blvd)\\b|, [A-Z]{2} \\d{5}|^[A-Z][\\w .'-]+, [A-Z]{2}$|^(sent from|发自)\\s",
  "i",
);
const SOCIAL = /^((facebook|twitter|𝕏|x|telegram|discord|linkedin|instagram|youtube|tiktok|weibo|微博|微信|wechat|github|reddit|medium)[\s·|•,]*)+$/i;
const JUNK = /^[\s\p{P}\p{S}\p{M}]*$/u;
const RULE = /^[-_=*~·.\s]{3,}$/;
const JUNK_MAX = 6;
const QUOTE_LINE = /^>/;
// 开头的 "在浏览器中查看" 之类, 在哪都去掉
const BROWSER_LINE = /^(view (this email |it |this )?(online|in (your |a )?browser)|在浏览器中(查看|打开)(此邮件)?|email not displaying correctly.*|邮件(无法|不能)正常显示.*)$/i;
const TAIL_SHARE = 0.4;
const TAIL_LINES = 6;
const RECENT = 3;

const isJunk = (l: string) => SOCIAL.test(l) || RULE.test(l) || (l.length <= JUNK_MAX && JUNK.test(l));

/** 引用历史从哪一行开始 (找不到为 -1); 第一行就是的不算 (整封是转发, 内容就在里面)。 */
function quoteStart(lines: string[]): number {
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (ORIGINAL.test(l) || CN_WROTE.test(l)) return i;
    if (WROTE.test(l)) return WROTE_HEAD.test(l) ? i : i - 1 >= 1 && WROTE_HEAD.test(lines[i - 1]!) ? i - 1 : i;
    if (OUTLOOK_FROM.test(l) && lines.slice(i + 1, i + 5).some((x) => OUTLOOK_META.test(x))) return i;
  }
  return -1;
}

/** 文本去噪: 逐行去掉引用历史, 签名, 页脚, 社交图标行与重复行, 输出一行一段。 */
export function denoise(text: string): string {
  let lines = text.replace(INVISIBLE, "").split(/\r?\n/).map((l) => l.replace(SPACES, " ").trim()).filter((l) => l && !QUOTE_LINE.test(l) && !BROWSER_LINE.test(l));
  const q = quoteStart(lines);
  if (q > 0) lines = lines.slice(0, q);
  const sig = lines.findIndex((l, i) => i > 0 && SIGNATURE.has(l));
  if (sig > 0) lines = lines.slice(0, sig);
  const n = lines.length;
  const foot = lines.findIndex((l, i) => i > 0 && FOOT_STRONG.test(l) && (i >= n * TAIL_SHARE || n - i <= TAIL_LINES));
  if (foot > 0) lines = lines.slice(0, foot);
  const half = lines.length / 2;
  const kept: string[] = [];
  lines.forEach((l, i) => {
    if (isJunk(l) || (i >= half && FOOT_WEAK.test(l))) return;
    if (kept.slice(-RECENT).includes(l)) return;
    kept.push(l);
  });
  while (kept.length > 1 && FOOT_WEAK.test(kept[kept.length - 1]!)) kept.pop();
  return kept.join("\n");
}

/** 有 HTML 用 HTML (纯文本部分常是简陋的自动转换), 否则用纯文本。 */
export function mailText(html: string | undefined, text: string | undefined): MailText {
  if (html) {
    const t = htmlText(html);
    return { ...t, text: denoise(t.text) };
  }
  const raw = text ?? "";
  return { text: denoise(raw), anchors: [], unsub: UNSUB.test(raw) };
}
