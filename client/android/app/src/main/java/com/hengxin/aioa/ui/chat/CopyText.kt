package com.hengxin.aioa.ui.chat

import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.FILE_TEXT_PREFIX
import com.hengxin.aioa.ui.feed.feedOf

private val TAG = Regex("<[^>]+>")
private val SPACES = Regex("[ \\t]+")
private val BLANK_LINES = Regex("\\n{3,}")
private val ENTITIES = listOf("&nbsp;" to " ", "&lt;" to "<", "&gt;" to ">", "&quot;" to "\"", "&#39;" to "'", "&amp;" to "&")

/**
 * 复制消息时的可读文本 (#139): 卡片与文件不复制原始文本 (JSON, HTML, "[文件] 名字" 占位),
 * 合并转发写成 "聊天记录" 加前几条, 信息流卡片写标题, 摘要与链接, 文件写名字与大小。
 */
fun copyText(m: ServerFrame.Msg): String {
    m.bundle?.let { b ->
        val head = b.head.joinToString("\n") { "${it.src}: ${it.text}" }
        return listOf("[聊天记录] ${b.from} · 共 ${b.count} 条", head).filter { it.isNotBlank() }.joinToString("\n")
    }
    if (m.feed != null) {
        val items = feedOf(m)
        if (items.isNotEmpty()) return items.joinToString("\n\n") { i -> listOfNotNull(i.title, i.summary, i.url).joinToString("\n") }
    }
    val caption = m.text.takeIf { it.isNotBlank() && !(m.file != null && it.startsWith(FILE_TEXT_PREFIX)) }
    m.html?.let { html -> return caption ?: htmlText(html) }
    m.file?.let { f -> return listOfNotNull(caption, "[文件] ${f.name} (${FileTransfer.sizeText(f.size)})").joinToString("\n") }
    return m.text
}

/** HTML 卡片去掉标签与样式, 留正文。 */
internal fun htmlText(html: String): String {
    val body = html.replace(Regex("(?is)<(script|style|head)[^>]*>.*?</\\1>"), "")
        .replace(Regex("(?i)<br\\s*/?>|</(p|div|li|tr|h[1-6])>"), "\n")
    var out = body.replace(TAG, "")
    ENTITIES.forEach { (k, v) -> out = out.replace(k, v) }
    return out.lines().joinToString("\n") { it.replace(SPACES, " ").trim() }.replace(BLANK_LINES, "\n\n").trim()
}
