package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Chip
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val TTLS = listOf(1 to "1 小时", 24 to "24 小时", 24 * 7 to "7 天", 0 to "不过期")
private const val DEFAULT_TTL = 24

private fun time(ts: Long) = SimpleDateFormat("MM-dd HH:mm", Locale.ROOT).format(Date(ts))

/** 待办插件的外部接入: 给别的 AI 一把只碰这个群待办的密钥, 默认 24 小时。 */
@Composable
fun TodoExtSection(channel: String) {
    val c = Aioa.colors
    val api = GhApi(LocalContext.current)
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var keys by remember { mutableStateOf<List<ExtKey>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var name by remember { mutableStateOf("Hark") }
    var write by remember { mutableStateOf(false) }
    var hours by remember { mutableStateOf(DEFAULT_TTL) }
    // 密钥只在新建时出现一次, 只放内存
    var made by remember { mutableStateOf<ExtCreated?>(null) }
    val reload = { scope.launch { api.extKeys(channel).onSuccess { keys = it }.onFailure { error = it.message } } }
    LaunchedEffect(channel) { reload() }
    made?.let { m ->
        val hint = "MCP 地址: ${m.mcp}\n请求头: Authorization: Bearer ${m.key}"
        SettingsGroup("新密钥 (只显示这一次)", "支持 MCP 的客户端填地址和请求头; 不支持的给它 Markdown 链接。") {
            NoteRow(hint, mono = true)
            RowDivider(indent = false)
            ActionRow("复制 MCP 配置", "copy") { clipboard.setText(AnnotatedString(hint)) }
            RowDivider(indent = false)
            ActionRow("复制 Markdown 链接", "link") { clipboard.setText(AnnotatedString(m.md)) }
        }
    }
    SettingsGroup("外部接入", "让 Hark, Claude, Cursor 等直接读写这个群的待办, 不用进群。") {
        InputRow("名称", name, "比如 Hark") { name = it }
        RowDivider()
        SwitchRow("允许修改", write, "关掉只能读; 打开可加待办, 改状态。") { write = it }
        RowDivider()
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TTLS.forEach { (h, label) -> Chip(label, hours == h) { hours = h } }
        }
        RowDivider(indent = false)
        ActionRow("新建接入密钥", "key-round") {
            scope.launch { api.createExt(channel, name.ifBlank { "外部接入" }, write, hours).onSuccess { made = it; reload() }.onFailure { error = it.message } }
        }
        error?.let { RowDivider(); NoteRow(it, c.danger) }
    }
    if (keys.isNotEmpty()) SettingsGroup("已发出的密钥") {
        keys.forEachIndexed { i, k ->
            if (i > 0) RowDivider()
            val until = k.expires?.let { "${time(it)} 到期" } ?: "不过期"
            val used = k.used?.let { " · ${time(it)} 用过" } ?: " · 没用过"
            ActionRow("${k.name} (${if (k.access == "write") "读写" else "只读"})", "trash-2", value = until + used, danger = true) {
                scope.launch { api.removeExt(channel, k.id).onSuccess { reload() }.onFailure { error = it.message } }
            }
        }
    }
}
