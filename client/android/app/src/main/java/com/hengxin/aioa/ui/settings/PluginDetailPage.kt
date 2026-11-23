package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.ui.chat.HtmlCard
import com.hengxin.aioa.ui.chat.MarkdownText
import com.hengxin.aioa.ui.chat.MdColors
import kotlinx.coroutines.launch

private const val TITLE_SP = 18
private const val META_SP = 12
private const val BODY_SP = 13
private val README_MAX = 4000.dp
private val README_SHAPE = RoundedCornerShape(14.dp)

/** 插件详情: 介绍 (Markdown 或沙箱 HTML), 安装 / 卸载; 刚装完显示接入语供复制。 */
@Composable
fun PluginDetailPage(id: String, onBack: () -> Unit, onChanged: () -> Unit, openGroup: (String) -> Unit) {
    val c = Aioa.colors
    val api = PluginApi(LocalContext.current)
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var detail by remember(id) { mutableStateOf<PluginDetail?>(null) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // 接入语含密钥, 只放内存, 离开页面就没了
    var prompt by remember(id) { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    var confirm by rememberSaveable { mutableStateOf(false) }
    val reload = { scope.launch { api.detail(id).onSuccess { detail = it; error = null }.onFailure { error = it.message } } }
    LaunchedEffect(id) { reload() }
    val d = detail
    SettingsPageFrame(d?.entry?.name ?: "插件", onBack) {
        error?.let { SettingsGroup { NoteRow(it, c.danger) } }
        if (d == null) {
            if (error == null) Paragraph("加载中...", c.textSecondary, BODY_SP)
            return@SettingsPageFrame
        }
        val e = d.entry
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            PluginIcon(e.icon)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(e.name, c.text, TITLE_SP, weight = FontWeight.SemiBold)
                Text(listOf("v${e.version}", e.author).filter { it.isNotEmpty() }.joinToString(" · "), c.textSecondary, META_SP)
            }
        }
        if (e.summary.isNotEmpty()) Paragraph(e.summary, c.text, BODY_SP + 1)
        val installed = e.installed
        val p = prompt
        if (p != null) {
            SettingsGroup("接入语", "把这段话原样发给你的 Agent (Claude Code, Codex 等)。它会自己拉指令, 报到, 并建好定时任务。里面有密钥, 只显示这一次。") {
                NoteRow(p, mono = true)
                RowDivider(indent = false)
                ActionRow(if (copied) "已复制" else "复制接入语", "copy") {
                    clipboard.setText(AnnotatedString(p))
                    copied = true
                }
            }
        }
        if (installed == null) {
            PrimaryAction(if (busy) "安装中..." else "安装", enabled = !busy) {
                busy = true
                scope.launch {
                    api.install(id).onSuccess { (_, text) -> prompt = text; onChanged(); reload() }.onFailure { error = it.message }
                    busy = false
                }
            }
            d.schedule?.let { Paragraph("建议的定时: $it", c.textSecondary, META_SP) }
        } else {
            SettingsGroup("已安装", d.schedule?.let { "建议的定时: $it" }) {
                InfoRow("群", installed.channel)
                RowDivider()
                ActionRow("打开群", "message-circle") { openGroup(installed.channel) }
                RowDivider()
                ActionRow("卸载", "trash-2", danger = true, enabled = !busy) { confirm = true }
            }
        }
        Column(Modifier.fillMaxWidth().clip(README_SHAPE).background(c.surface).padding(16.dp)) {
            if (d.html) HtmlCard(d.readme, maxHeight = README_MAX)
            else MarkdownText(d.readme, MdColors(c.text, c.textSecondary, c.accent, c.surfaceAlt))
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { androidx.compose.material3.Text("卸载 ${d?.entry?.name.orEmpty()}?") },
            text = { androidx.compose.material3.Text("会作废它的 Agent 密钥并移除工作台面板。群里的消息和待办保留, 重新安装能接上。") },
            confirmButton = {
                TextButton({
                    confirm = false
                    busy = true
                    scope.launch {
                        api.uninstall(id).onSuccess { prompt = null; onChanged(); reload() }.onFailure { error = it.message }
                        busy = false
                    }
                }) { androidx.compose.material3.Text("卸载", color = c.danger) }
            },
            dismissButton = { TextButton({ confirm = false }) { androidx.compose.material3.Text("取消") } },
        )
    }
}
