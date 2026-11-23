package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.proto.plainLine

/** Markdown 的块: 只支持聊天里常见的写法, 解析结果按文本缓存。 */
sealed interface MdBlock {
    data class Para(val text: String) : MdBlock
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Quote(val lines: List<String>) : MdBlock
    data class Bullets(val items: List<Pair<String, String>>) : MdBlock
    data class Code(val text: String) : MdBlock
    data object Rule : MdBlock
}

/** 渲染用到的颜色, 由气泡决定。 */
data class MdColors(val text: Color, val muted: Color, val link: Color, val codeBg: Color)

private const val FENCE = "```"
private const val MAX_HEADING = 6
private val BULLET = Regex("^\\s*([-*+]|\\d{1,3}[.)])\\s+(.*)$")
private val RULE = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
private val HEADING = Regex("^(#{1,6})\\s+(.*)$")
private val URL = Regex("https?://[^\\s<>()\\[\\]]+[^\\s<>()\\[\\].,;:!?'\"]")
private val CODE_SHAPE = RoundedCornerShape(6.dp)

fun parseMarkdown(src: String): List<MdBlock> {
    val out = ArrayList<MdBlock>()
    val lines = src.replace("\r\n", "\n").split('\n')
    var i = 0
    val para = StringBuilder()
    fun flush() {
        if (para.isNotBlank()) out.add(MdBlock.Para(para.toString().trimEnd()))
        para.clear()
    }
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trimStart()
        when {
            trimmed.startsWith(FENCE) -> {
                flush()
                val code = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith(FENCE)) code.appendLine(lines[i++])
                out.add(MdBlock.Code(code.toString().trimEnd('\n')))
            }
            line.isBlank() -> flush()
            RULE.matches(line) -> { flush(); out.add(MdBlock.Rule) }
            HEADING.matches(trimmed) -> {
                flush()
                val m = HEADING.find(trimmed)!!
                out.add(MdBlock.Heading(m.groupValues[1].length.coerceAtMost(MAX_HEADING), m.groupValues[2]))
            }
            trimmed.startsWith(">") -> {
                flush()
                val q = ArrayList<String>()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) q.add(lines[i++].trimStart().removePrefix(">").removePrefix(" "))
                out.add(MdBlock.Quote(q))
                continue
            }
            BULLET.matches(line) -> {
                flush()
                val items = ArrayList<Pair<String, String>>()
                while (i < lines.size) {
                    val m = BULLET.find(lines[i]) ?: break
                    val mark = m.groupValues[1].let { if (it[0].isDigit()) it else "•" }
                    items.add(mark to m.groupValues[2])
                    i++
                }
                out.add(MdBlock.Bullets(items))
                continue
            }
            else -> { if (para.isNotEmpty()) para.append('\n'); para.append(line) }
        }
        i++
    }
    flush()
    return out
}

/** 行内: `代码`, **粗**, *斜*, ~~删除~~, [文字](链接), 裸链接。 */
fun inlineMarkdown(src: String, c: MdColors): AnnotatedString = buildAnnotatedString {
    val links = TextLinkStyles(SpanStyle(color = c.link, textDecoration = TextDecoration.Underline))
    var i = 0
    while (i < src.length) {
        val ch = src[i]
        fun wrap(open: String, close: String = open, style: SpanStyle): Boolean {
            if (!src.startsWith(open, i)) return false
            val end = src.indexOf(close, i + open.length)
            if (end <= i + open.length) return false
            withStyle(style) { append(inlineMarkdown(src.substring(i + open.length, end), c)) }
            i = end + close.length
            return true
        }
        when {
            ch == '\\' && i + 1 < src.length -> { append(src[i + 1]); i += 2 }
            ch == '`' -> {
                val end = src.indexOf('`', i + 1)
                if (end > i) {
                    withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = c.codeBg)) { append(src.substring(i + 1, end)) }
                    i = end + 1
                } else { append(ch); i++ }
            }
            wrap("**", style = SpanStyle(fontWeight = FontWeight.Bold)) -> Unit
            wrap("__", style = SpanStyle(fontWeight = FontWeight.Bold)) -> Unit
            wrap("~~", style = SpanStyle(textDecoration = TextDecoration.LineThrough)) -> Unit
            ch == '*' && i + 1 < src.length && src[i + 1] != ' ' && wrap("*", style = SpanStyle(fontStyle = FontStyle.Italic)) -> Unit
            ch == '[' -> {
                val close = src.indexOf("](", i)
                val end = if (close > i) src.indexOf(')', close) else -1
                if (close > i && end > close) {
                    val url = src.substring(close + 2, end).trim()
                    withLink(LinkAnnotation.Url(url, links)) { append(inlineMarkdown(src.substring(i + 1, close), c)) }
                    i = end + 1
                } else { append(ch); i++ }
            }
            ch == 'h' && (src.startsWith("http://", i) || src.startsWith("https://", i)) -> {
                val m = URL.matchAt(src, i)
                if (m != null) {
                    withLink(LinkAnnotation.Url(m.value, links)) { append(m.value) }
                    i += m.value.length
                } else { append(ch); i++ }
            }
            else -> { append(ch); i++ }
        }
    }
}

@Composable
fun MarkdownText(text: String, colors: MdColors, modifier: Modifier = Modifier) {
    val blocks = remember(text) { parseMarkdown(text) }
    // 纯文本消息最常见, 直接一个 Text, 少一层布局
    val single = blocks.singleOrNull() as? MdBlock.Para
    if (single != null) {
        val s = remember(text, colors) { inlineMarkdown(single.text, colors) }
        Text(s, modifier, color = colors.text, fontSize = BODY_SP.sp, lineHeight = LINE_SP.sp)
        return
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        blocks.forEach { Block(it, colors) }
    }
}

private const val BODY_SP = 15
private const val LINE_SP = 21

@Composable
private fun Block(b: MdBlock, c: MdColors) {
    when (b) {
        is MdBlock.Para -> Text(inlineMarkdown(b.text, c), color = c.text, fontSize = BODY_SP.sp, lineHeight = LINE_SP.sp)
        is MdBlock.Heading -> Text(
            inlineMarkdown(b.text, c),
            color = c.text,
            fontWeight = FontWeight.SemiBold,
            fontSize = (BODY_SP + (MAX_HEADING - b.level).coerceAtMost(4)).sp,
        )
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(c.link.copy(alpha = 0.6f), CODE_SHAPE))
            Column(Modifier.padding(start = 8.dp)) {
                MarkdownText(b.lines.joinToString("\n"), c.copy(text = c.muted))
            }
        }
        is MdBlock.Bullets -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            b.items.forEach { (mark, t) ->
                Row {
                    Text(mark, Modifier.padding(end = 6.dp), color = c.muted, fontSize = BODY_SP.sp)
                    Text(inlineMarkdown(t, c), color = c.text, fontSize = BODY_SP.sp, lineHeight = LINE_SP.sp)
                }
            }
        }
        is MdBlock.Code -> Box(Modifier.background(c.codeBg, CODE_SHAPE).horizontalScroll(rememberScrollState()).padding(8.dp)) {
            Text(b.text, color = c.text, fontFamily = FontFamily.Monospace, fontSize = 13.sp, softWrap = false)
        }
        MdBlock.Rule -> Box(Modifier.width(120.dp).height(1.dp).background(c.muted.copy(alpha = 0.4f)))
    }
}

/** 列表和通知里用的一行摘要: 去掉 Markdown 与 HTML 标记。 */
fun plainPreview(src: String): String = plainLine(src)
