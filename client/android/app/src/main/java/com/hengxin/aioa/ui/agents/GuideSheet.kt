package com.hengxin.aioa.ui.agents

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val FIRST_TITLE = "身份与命令"
private const val PLUGIN_MARK = "插件任务"
private val BOX = RoundedCornerShape(12.dp)

private data class Section(val title: String, val body: String)

// 按 ## / ### 标题切块; 第一行的 "# 专属指令" 只取版本号做副标题
private fun split(text: String): Pair<String?, List<Section>> {
    val lines = text.lines()
    val head = lines.firstOrNull()?.takeIf { it.startsWith("# ") }?.removePrefix("# ")
    val out = mutableListOf<Section>()
    var title = FIRST_TITLE
    val buf = StringBuilder()
    fun flush() {
        if (buf.isNotBlank()) out.add(Section(title, buf.toString().trim()))
        buf.clear()
    }
    for (l in if (head != null) lines.drop(1) else lines) {
        if (l.startsWith("## ") || l.startsWith("### ")) {
            flush()
            title = l.trimStart('#').trim()
        } else buf.appendLine(l)
    }
    flush()
    return head to out
}

/** 查看指令: 分段折叠, 默认只展开插件任务 (没有插件就展开第一段)。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GuideSheet(name: String, text: String, close: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    val (head, sections) = remember(text) { split(text) }
    val first = sections.indexOfFirst { PLUGIN_MARK in it.title }.takeIf { it >= 0 } ?: 0
    var open by remember(text) { mutableStateOf(setOf(first)) }
    val c = MaterialTheme.colorScheme
    ModalBottomSheet(onDismissRequest = close) {
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("$name 的指令", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    Text(head ?: "服务端生成, 不含密钥", fontSize = 12.sp, color = c.outline)
                }
                TextButton({ clipboard.setText(AnnotatedString(text)) }) { Text("复制全文") }
            }
            sections.forEachIndexed { i, s ->
                val shown = i in open
                Column(Modifier.fillMaxWidth().background(c.surfaceVariant.copy(alpha = 0.6f), BOX)) {
                    Row(Modifier.fillMaxWidth().clickable { open = if (shown) open - i else open + i }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(s.title, Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.Medium)
                        Text(if (shown) "收起" else "展开", fontSize = 12.sp, color = c.primary)
                    }
                    AnimatedVisibility(shown) {
                        SelectionContainer { Text(s.body, Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), fontSize = 13.sp, lineHeight = 19.sp) }
                    }
                }
            }
        }
    }
}
