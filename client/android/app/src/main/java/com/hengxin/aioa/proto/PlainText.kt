package com.hengxin.aioa.proto

private val FENCE = Regex("^\\s*(```|~~~).*$")
private val HEADING = Regex("^\\s{0,3}#{1,6}\\s+")
private val QUOTE = Regex("^\\s*>+\\s?")
private val BULLET = Regex("^(\\s*)[-*+]\\s+(\\[[ xX]]\\s+)?")
private val RULE = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
private val TABLE_SEP = Regex("^\\s*\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?\\s*$")
private val IMAGE = Regex("!\\[([^\\]]*)]\\([^)]*\\)")
private val LINK = Regex("\\[([^\\]]+)]\\([^)]*\\)")
private val STRONG = Regex("(\\*\\*|__)(.+?)\\1")
private val EM = Regex("(?<![\\w*])([*_])(?!\\s)(.+?)(?<!\\s)\\1(?![\\w*])")
private val STRIKE = Regex("~~(.+?)~~")
private val CODE = Regex("`([^`]+)`")
private val INLINE_TAG = Regex("</?(b|i|u|s|em|strong|code|span|font|a|br|small|mark|del|sup|sub|p|div)(\\s[^>]*)?/?>", RegexOption.IGNORE_CASE)
private val ENTITY = Regex("&(#\\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);")
private val SPACES = Regex("[ \\t\\u3000]+")
private val BLANKS = Regex("\\n{3,}")
private val NAMED = mapOf("nbsp" to " ", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "amp" to "&", "middot" to "·", "hellip" to "…", "mdash" to "—", "ndash" to "–")

/** 通知, 列表摘要这些只能放纯文字的地方用: HTML 去标签, Markdown 去标记, 保留换行与列表点。不依赖 Compose, :link 进程可用。 */
fun plainText(src: String): String {
    val raw = if (looksHtml(src)) htmlText(src) else src
    var fenced = false
    val lines = raw.replace("\r\n", "\n").lines().mapNotNull { line ->
        if (FENCE.matches(line)) {
            fenced = !fenced
            return@mapNotNull null
        }
        if (fenced) return@mapNotNull line
        if (RULE.matches(line) || TABLE_SEP.matches(line)) return@mapNotNull null
        var s = line.replace(HEADING, "").replace(QUOTE, "")
        s = BULLET.replace(s) { "${it.groupValues[1]}• " }
        if (s.trimStart().startsWith("|")) s = s.trim().trim('|').split('|').joinToString("  ") { it.trim() }
        inline(s)
    }
    return lines.joinToString("\n").replace(BLANKS, "\n\n").trim()
}

/** 只要一行: 换行压成空格。 */
fun plainLine(src: String): String = plainText(src).replace('\n', ' ').replace(SPACES, " ").trim()

private fun inline(src: String): String {
    var s = src.replace(IMAGE, "$1").replace(LINK, "$1").replace(INLINE_TAG, "")
    s = s.replace(STRONG, "$2").replace(STRIKE, "$1").replace(CODE, "$1").replace(EM, "$2")
    return ENTITY.replace(s) { m -> entity(m.groupValues[1]) ?: m.value }.replace(SPACES, " ").trimEnd()
}

private fun entity(name: String): String? = when {
    name.startsWith("#x") || name.startsWith("#X") -> name.drop(2).toIntOrNull(16)?.let { String(Character.toChars(it)) }
    name.startsWith("#") -> name.drop(1).toIntOrNull()?.let { String(Character.toChars(it)) }
    else -> NAMED[name.lowercase()]
}
