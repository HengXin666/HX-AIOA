package com.hengxin.aioa.proto

/** 系统通知里的正文 (#151): 去 Markdown 与 HTML, 链接只留文字, 图片文件换占位, 折叠空白并截断。不依赖 Android, 可单测。 */
object NotifyText {
    const val IMAGE = "[图片]"
    const val FILE = "[文件]"
    const val CARD = "[卡片]"
    const val RECORD = "[聊天记录]"
    const val OTP = "验证码"
    const val MAX_BODY = 300
    const val MAX_LINE = 120
    private const val ELLIPSIS = "…"
    private const val JOIN = " · "
    private val IC = RegexOption.IGNORE_CASE
    private val COMMENT = Regex("<!--[\\s\\S]*?-->")
    private val MD_IMAGE = Regex("!\\[[^\\]]*]\\([^)]*\\)")
    private val HTML_IMAGE = Regex("<img\\b[^>]*>", IC)
    private val AUTOLINK = Regex("<((?:https?|mailto):[^>\\s]+)>", IC)
    private val REF_LINK = Regex("\\[([^\\]]+)]\\[[^\\]]*]")
    private val REF_DEF = Regex("^\\s{0,3}\\[[^\\]]+]:\\s*\\S+.*$", RegexOption.MULTILINE)
    private val DROP = Regex("<(style|script|head)\\b[\\s\\S]*?</\\1>", IC)
    private val BREAK = Regex("<br\\s*/?>|</(p|div|li|h[1-6]|tr|blockquote|pre|table|ul|ol)>", IC)
    private val TAG = Regex(
        "</?(a|b|i|u|s|em|strong|code|span|font|small|mark|del|ins|sup|sub|p|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|" +
            "blockquote|pre|hr|section|article|center|kbd|q|tt|big|html|body|label|details|summary)(\\s[^>]*)?/?>",
        IC,
    )
    private val BULLET = Regex("^\\s*•\\s+")
    private val SPACES = Regex("[ \\t\\u3000\\u00a0]+")

    /** 任意 Markdown / HTML 文本转成通知可放的纯文本, 保留至多一层换行。 */
    fun clean(src: String, max: Int = MAX_BODY): String {
        var s = src.replace("\r\n", "\n").replace(COMMENT, "").replace(DROP, "")
            .replace(MD_IMAGE, IMAGE).replace(HTML_IMAGE, IMAGE)
            .replace(AUTOLINK, "$1").replace(REF_DEF, "").replace(REF_LINK, "$1")
        s = s.replace(BREAK, "\n").replace(TAG, "")
        val lines = plainText(s).lines().map { it.replace(BULLET, "").replace(SPACES, " ").trim() }.filter { it.isNotEmpty() }
        return cut(lines.joinToString("\n"), max)
    }

    /** 只要一行 (折叠后的通知, 组摘要)。 */
    fun line(src: String, max: Int = MAX_LINE): String = cut(clean(src, Int.MAX_VALUE).replace('\n', ' '), max)

    /** 一条聊天消息: 只发文件时正文是 "[文件] 名字" 占位, 图片显示 [图片]; 卡片与合并转发没有正文时给占位。 */
    fun message(text: String, file: FileRef? = null, card: Boolean = false, bundle: Bundle? = null): String {
        val body = clean(text)
        if (file != null) {
            val tag = if (file.image) IMAGE else "$FILE ${file.name}"
            val caption = body.takeUnless { it.isEmpty() || it.startsWith(FILE) || it.startsWith(IMAGE) }
            return cut(listOfNotNull(tag, caption).joinToString(" "), MAX_BODY)
        }
        if (body.isNotEmpty()) return body
        return when {
            bundle != null -> "$RECORD ${bundle.from}".trim()
            card -> CARD
            else -> ""
        }
    }

    /** 一封信 (#146): 验证码信只显示验证码, 其余是主题加要点; 老信没有要点时用摘要。 */
    fun mail(subject: String, code: String?, brief: String?, summary: String?): String {
        val title = line(subject)
        code?.trim()?.takeIf { it.isNotEmpty() }?.let { return listOf("$OTP $it", title).filter { s -> s.isNotEmpty() }.joinToString(JOIN) }
        val more = (brief?.takeIf { it.isNotBlank() } ?: summary)?.let { clean(it) }?.takeIf { it.isNotEmpty() && it != title }
        return cut(listOfNotNull(title.ifEmpty { null }, more).joinToString("\n"), MAX_BODY)
    }

    fun cut(s: String, max: Int): String {
        if (s.length <= max) return s
        var end = max - ELLIPSIS.length
        if (end > 0 && Character.isHighSurrogate(s[end - 1])) end--
        return s.take(maxOf(end, 0)).trimEnd() + ELLIPSIS
    }
}
