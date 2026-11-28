package com.hengxin.aioa.ui.chat

// 邮件精简正文 (#146), 移植自 protocol/src/v1/mail-clean.ts, 规则要两边一起改 (快照测试共用 protocol/fixtures/mail)。
// 只用于服务端还没提取过的老信, 以及详情里把原文转成精简正文。

/** 一个链接: 文字与地址。 */
data class MailAnchor(val label: String, val url: String)

/** 转换结果: 文本 (一行一段), 链接, 是否有退订入口。 */
data class MailText(val text: String, val anchors: List<MailAnchor>, val unsub: Boolean)

object MailClean {
    private val IC = RegexOption.IGNORE_CASE
    private val RAW_BLOCKS = Regex("<(style|script|head|title|noscript|template|svg)\\b[\\s\\S]*?</\\1\\s*>", IC)
    private val COMMENT = Regex("<!--[\\s\\S]*?-->")
    private val DECL = Regex("<![^>]*>")
    // 占有量词: Java 正则对分支循环是递归匹配, 长属性会栈溢出
    private val TAG = Regex("<(/?)([a-zA-Z][a-zA-Z0-9]*)\\b((?:[^>\"']++|\"[^\"]*+\"|'[^']*+')*+)>")
    private val VOID = setOf("br", "img", "hr", "meta", "link", "input", "wbr", "source", "col", "area", "base", "embed", "param", "track")
    private val BLOCK = setOf(
        "p", "div", "br", "li", "tr", "td", "th", "table", "ul", "ol", "blockquote", "section", "article", "header", "footer", "hr", "center",
        "pre", "dt", "dd", "details", "summary", "address", "figure", "figcaption", "form", "h1", "h2", "h3", "h4", "h5", "h6",
    )
    private val HIDDEN = Regex("display\\s*:\\s*none|visibility\\s*:\\s*hidden|mso-hide\\s*:\\s*all", IC)
    private val SHRUNK = Regex("max-height\\s*:\\s*0(?![.\\d])", IC)
    private val CLIP = Regex("overflow\\s*:\\s*hidden", IC)
    private val QUOTE_ATTR = Regex("\\btype\\s*=\\s*[\"']?cite|gmail_quote|yahoo_quoted|protonmail_quote", IC)
    private val OUTLOOK_CUT = Regex("divRplyFwdMsg|id\\s*=\\s*[\"']?(?:appendonsend|mail-editor-reference-message-container)", IC)
    private val BARE_HIDDEN = Regex("(^|\\s)hidden(\\s|=|$)", IC)
    private val STYLE_ATTR = Regex("\\bstyle\\s*=\\s*(\"[^\"]*\"|'[^']*')", IC)
    private val HREF_ATTR = Regex("\\bhref\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s>]+)", IC)
    val UNSUB = Regex("unsubscribe|退订|取消订阅|opt[- ]?out", IC)
    private val INVISIBLE = Regex("[\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180e\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2064\\u206a-\\u206f\\u3164\\ufeff\\uffa0]")
    private val SPACES = Regex("[ \\t\\r\\n\\u000c\\u00a0\\u3000]+")
    private val CRLF = Regex("\\r\\n?")
    private val ENTITY = Regex("&(#[xX][0-9a-fA-F]+|#\\d+|[a-zA-Z]+);")
    private val HTTP = Regex("^https?:", IC)
    private val NAMED = mapOf(
        "nbsp" to " ", "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "mdash" to "—", "ndash" to "–", "hellip" to "…",
        "copy" to "©", "reg" to "®", "trade" to "™", "middot" to "·", "bull" to "•", "rsquo" to "’", "lsquo" to "‘", "rdquo" to "”", "ldquo" to "“",
        "yen" to "¥", "euro" to "€", "pound" to "£", "zwnj" to "", "zwj" to "", "shy" to "", "ensp" to " ", "emsp" to " ", "thinsp" to " ",
        "laquo" to "«", "raquo" to "»", "times" to "×", "rarr" to "→", "larr" to "←",
    )
    private const val MAX_CODE_POINT = 0x10ffff

    fun decodeEntities(s: String): String = ENTITY.replace(s) { m ->
        val e = m.groupValues[1]
        if (e[0] != '#') return@replace NAMED[e.lowercase()] ?: m.value
        val cp = if (e.length > 1 && (e[1] == 'x' || e[1] == 'X')) e.substring(2).toIntOrNull(16) else e.substring(1).toIntOrNull()
        if (cp != null && cp in 1..MAX_CODE_POINT) StringBuilder().appendCodePoint(cp).toString() else ""
    }

    private fun attrOf(re: Regex, attrs: String): String {
        val v = re.find(attrs)?.groupValues?.get(1).orEmpty()
        return if (v.startsWith("\"") || v.startsWith("'")) v.substring(1, v.length - 1) else v
    }

    private fun hiddenTag(attrs: String): Boolean {
        val style = attrOf(STYLE_ATTR, attrs)
        return HIDDEN.containsMatchIn(style) || (SHRUNK.containsMatchIn(style) && CLIP.containsMatchIn(style)) ||
            QUOTE_ATTR.containsMatchIn(attrs) || BARE_HIDDEN.containsMatchIn(attrs.replace(STYLE_ATTR, ""))
    }

    /** HTML 转文本: 块级元素换行, 列表项前加 "- ", 隐藏元素与引用块整段跳过, 图片丢掉, 链接只留文字并单独收集。 */
    fun htmlText(html: String): MailText {
        val src = html.replace(COMMENT, "").replace(DECL, "").replace(RAW_BLOCKS, "")
        val stack = ArrayList<String>()
        val anchors = ArrayList<MailAnchor>()
        val out = StringBuilder()
        var skipAt = -1
        var unsub = false
        var linkUrl: String? = null
        var linkAt = 0
        var last = 0
        // <pre> 里保留换行 (纯文本信转成的网页就是一整段 pre)
        fun emit(raw: String) {
            if (skipAt >= 0 || raw.isEmpty()) return
            val t = decodeEntities(raw).replace(INVISIBLE, "")
            out.append(if ("pre" in stack) t.replace(CRLF, "\n") else t.replace(SPACES, " "))
        }
        for (m in TAG.findAll(src)) {
            if (m.range.first < last) continue
            emit(src.substring(last, m.range.first))
            last = m.range.last + 1
            val close = m.groupValues[1] == "/"
            val name = m.groupValues[2].lowercase()
            val attrs = m.groupValues[3]
            if (!close && OUTLOOK_CUT.containsMatchIn(attrs)) {
                last = src.length
                break
            }
            if (close) {
                val i = stack.lastIndexOf(name)
                if (i < 0) continue
                while (stack.size > i) stack.removeAt(stack.size - 1)
                if (skipAt >= 0 && stack.size <= skipAt) { skipAt = -1; continue }
                if (skipAt >= 0) continue
                val url = linkUrl
                if (name == "a" && url != null) {
                    val label = out.substring(linkAt).replace(SPACES, " ").trim()
                    if (UNSUB.containsMatchIn(label) || UNSUB.containsMatchIn(url)) unsub = true
                    else if (HTTP.containsMatchIn(url) && label.isNotEmpty()) anchors.add(MailAnchor(label, url))
                    linkUrl = null
                }
                if (name in BLOCK) out.append('\n')
                continue
            }
            val selfClose = name in VOID || attrs.trimEnd().endsWith("/")
            if (skipAt < 0 && hiddenTag(attrs) && !selfClose) {
                skipAt = stack.size
                stack.add(name)
                continue
            }
            if (!selfClose) stack.add(name)
            if (skipAt >= 0) continue
            if (name == "a") { linkUrl = decodeEntities(attrOf(HREF_ATTR, attrs)).trim(); linkAt = out.length }
            if (name in BLOCK) out.append('\n')
            if (name == "li") out.append("- ")
        }
        if (last < src.length) emit(src.substring(last))
        return MailText(out.toString(), anchors, unsub)
    }

    private val WROTE = Regex("(wrote|schrieb|a écrit|escribió)\\s*:\\s*$", IC)
    private val WROTE_HEAD = Regex("^(on|am|le|el)\\s", IC)
    private val CN_WROTE = Regex("写道\\s*[:：]?\\s*$")
    private val ORIGINAL = Regex("^[-_=]{2,}\\s*(original message|forwarded message|原始邮件|转发邮件|转发的邮件|原邮件)\\s*[-_=]{2,}$", IC)
    private val OUTLOOK_FROM = Regex("^(from|发件人)\\s*[:：]", IC)
    private val OUTLOOK_META = Regex("^(sent|date|to|subject|发送时间|日期|时间|收件人|主题)\\s*[:：]", IC)
    private val SIGNATURE = setOf("--", "—", "——", "__", "-- ")
    private val FOOT_STRONG = Regex(
        "unsubscribe|退订|取消订阅|you('re| are) receiving this|you received this (email|message)|(此|本)邮件(由|为)系统自动发送|系统自动发送|请勿直接回复|" +
            "do not reply to this (email|message)|manage (your )?(email |notification )?(preferences|notifications|subscriptions)|notification settings|" +
            "通知设置|reply to this email directly|view (this email |it )?in (your |a )?browser|在浏览器中(查看|打开)",
        IC,
    )
    private val FOOT_WEAK = Regex(
        "privacy policy|隐私政策|隐私条款|terms of (service|use)|服务条款|用户协议|all rights reserved|版权所有|copyright|^©|©\\s*\\d{4}|\\(c\\)\\s*\\d{4}|" +
            "^powered by|github, inc\\.|\\b(street|avenue|road|suite|blvd)\\b.*\\d|\\d.*\\b(street|avenue|road|suite|blvd)\\b|, [A-Z]{2} \\d{5}|^[A-Z][\\w .'-]+, [A-Z]{2}$|^(sent from|发自)\\s",
        IC,
    )
    private val SOCIAL = Regex("^((facebook|twitter|𝕏|x|telegram|discord|linkedin|instagram|youtube|tiktok|weibo|微博|微信|wechat|github|reddit|medium)[\\s·|•,]*)+$", IC)
    private val JUNK = Regex("^[\\s\\p{P}\\p{S}\\p{M}]*$")
    private val RULE = Regex("^[-_=*~·.\\s]{3,}$")
    private const val JUNK_MAX = 6
    private val BROWSER_LINE = Regex("^(view (this email |it |this )?(online|in (your |a )?browser)|在浏览器中(查看|打开)(此邮件)?|email not displaying correctly.*|邮件(无法|不能)正常显示.*)$", IC)
    private const val TAIL_SHARE = 0.4
    private const val TAIL_LINES = 6
    private const val RECENT = 3

    private fun isJunk(l: String) = SOCIAL.matches(l) || RULE.matches(l) || (l.length <= JUNK_MAX && JUNK.matches(l))

    private fun quoteStart(lines: List<String>): Int {
        for (i in 1 until lines.size) {
            val l = lines[i]
            if (ORIGINAL.containsMatchIn(l) || CN_WROTE.containsMatchIn(l)) return i
            if (WROTE.containsMatchIn(l)) return if (WROTE_HEAD.containsMatchIn(l)) i else if (i - 1 >= 1 && WROTE_HEAD.containsMatchIn(lines[i - 1])) i - 1 else i
            if (OUTLOOK_FROM.containsMatchIn(l) && lines.subList(i + 1, minOf(lines.size, i + 5)).any { OUTLOOK_META.containsMatchIn(it) }) return i
        }
        return -1
    }

    /** 文本去噪: 逐行去掉引用历史, 签名, 页脚, 社交图标行与重复行, 输出一行一段。 */
    fun denoise(text: String): String {
        var lines = text.replace(INVISIBLE, "").split(Regex("\\r?\\n")).map { it.replace(SPACES, " ").trim() }
            .filter { it.isNotEmpty() && !it.startsWith(">") && !BROWSER_LINE.containsMatchIn(it) }
        val q = quoteStart(lines)
        if (q > 0) lines = lines.subList(0, q)
        val sig = lines.withIndex().indexOfFirst { (i, l) -> i > 0 && l in SIGNATURE }
        if (sig > 0) lines = lines.subList(0, sig)
        val n = lines.size
        val foot = lines.withIndex().indexOfFirst { (i, l) -> i > 0 && FOOT_STRONG.containsMatchIn(l) && (i >= n * TAIL_SHARE || n - i <= TAIL_LINES) }
        if (foot > 0) lines = lines.subList(0, foot)
        val half = lines.size / 2.0
        val kept = ArrayList<String>()
        lines.forEachIndexed { i, l ->
            if (isJunk(l) || (i >= half && FOOT_WEAK.containsMatchIn(l))) return@forEachIndexed
            if (l in kept.takeLast(RECENT)) return@forEachIndexed
            kept.add(l)
        }
        while (kept.size > 1 && FOOT_WEAK.containsMatchIn(kept.last())) kept.removeAt(kept.size - 1)
        return kept.joinToString("\n")
    }

    /** 有 HTML 用 HTML, 否则用纯文本。 */
    fun mailText(html: String?, text: String?): MailText {
        if (!html.isNullOrEmpty()) {
            val t = htmlText(html)
            return t.copy(text = denoise(t.text))
        }
        val raw = text.orEmpty()
        return MailText(denoise(raw), emptyList(), UNSUB.containsMatchIn(raw))
    }
}
