package com.hengxin.aioa.ui.feed

import com.hengxin.aioa.proto.ServerFrame

// 旧格式推送 (HTML 卡片 + "【类别】a；b" 摘要) 拆成条目, 样式和 feed 一致, 点开看原卡片
private val SECTION = Regex("^[【\\[](.+?)[】\\]]\\s*(.+)$")
private val SPLIT = Regex("[；;]")
private val MD_MARK = charArrayOf('#', ' ', '*')
// 群标签表里找不到同名标签时, 按常见版块名归类
private val KIND_WORDS = listOf(
    "deal" to listOf("福利", "羊毛", "优惠", "免费"),
    "oss" to listOf("开源", "项目", "工具"),
    "news" to listOf("资讯", "新闻", "前沿", "动态"),
)
private const val TITLE_MAX = 120

private fun kindOf(label: String, tags: List<FeedTag>): String {
    tags.firstOrNull { it.id != TAG_OTHER && (label.contains(it.label) || it.label.contains(label)) }?.let { return it.id }
    val guess = KIND_WORDS.firstOrNull { (_, words) -> words.any { label.contains(it) } }?.first
    return guess?.takeIf { g -> tags.any { it.id == g } } ?: TAG_OTHER
}

/** 没有 data.feed 的消息: 能拆的按条拆开, 不能拆的整条算一条 "其他"; 都带原 HTML 供点开。 */
fun legacyItems(m: ServerFrame.Msg, tags: List<FeedTag>): List<FeedItem> {
    if (m.deleted != null || m.text.isBlank()) return emptyList()
    val lines = m.text.trim().lines().map { it.trim() }.filter { it.isNotEmpty() }
    val head = lines.first().trim(*MD_MARK).take(TITLE_MAX)
    val body = lines.drop(1)
    val key = "m:${m.id ?: m.seq}"
    fun item(k: String, title: String, summary: String?, kind: String) =
        FeedItem(k, title, null, null, kind, null, summary, null, null, null, emptyList(), m.src, m.ts, m.seq, m.html)
    val parts = body.mapNotNull { SECTION.find(it) }.flatMap { r ->
        val kind = kindOf(r.groupValues[1], tags)
        r.groupValues[2].split(SPLIT).map { it.trim() }.filter { it.isNotEmpty() }.map { kind to it }
    }
    if (parts.isEmpty()) return listOf(item(key, head, body.joinToString("\n").ifEmpty { null }, TAG_OTHER))
    return parts.mapIndexed { i, (kind, title) -> item("$key:$i", title.take(TITLE_MAX), head, kind) }
}
