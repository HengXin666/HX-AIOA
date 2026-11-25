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
private const val GH_ID = "gh"
private const val TODO_ID = "todo"

/** 插件详情: 介绍 (Markdown 或沙箱 HTML), 安装 / 卸载; 刚装完显示接入语供复制。 */
@Composable
fun PluginDetailPage(id: String, onBack: () -> Unit, onChanged: () -> Unit, openGroup: (String) -> Unit) {
    val c = Aioa.colors
    val api = PluginApi(LocalContext.current)
    val scope = rememberCoroutineScope()
    var detail by remember(id) { mutableStateOf<PluginDetail?>(null) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // 接入语含密钥, 只放内存, 离开页面就没了
    var prompt by remember(id) { mutableStateOf<PluginInstalled?>(null) }
    var confirm by rememberSaveable { mutableStateOf(false) }
    // 依赖插件的安装情况, 有依赖时才拉列表
    var others by remember(id) { mutableStateOf<Map<String, PluginEntry>>(emptyMap()) }
    val reload = {
        scope.launch {
            api.detail(id).onSuccess { detail = it; error = null }.onFailure { error = it.message }
            if (detail?.entry?.deps?.isNotEmpty() == true) api.list().onSuccess { (l, _) -> others = l.associateBy { it.id } }
        }
    }
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
                val ver = if (e.outdated) "已装 v${e.installed?.version}, 最新 v${e.version}" else "v${e.version}"
                Text(listOf(ver, e.author).filter { it.isNotEmpty() }.joinToString(" · "), c.textSecondary, META_SP)
            }
        }
        if (e.summary.isNotEmpty()) Paragraph(e.summary, c.text, BODY_SP + 1)
        val installed = e.installed
        val p = prompt
        if (p != null && p.prompt.isNotEmpty()) Handoff(p)
        if (e.deps.isNotEmpty()) SettingsGroup("依赖") {
            e.deps.forEachIndexed { i, dep ->
                if (i > 0) RowDivider()
                val o = others[dep.id]
                val ok = o?.installed != null
                InfoRow((o?.name ?: dep.id) + if (dep.optional) " (可选)" else "", if (ok) "已满足" else if (dep.optional) "没装, 相关功能不出现" else "需要先装", if (ok) c.success else c.textSecondary)
            }
        }
        if (installed == null) {
            PrimaryAction(if (busy) "安装中..." else "安装", enabled = !busy) {
                busy = true
                scope.launch {
                    api.install(id).onSuccess { prompt = it; onChanged(); reload() }.onFailure { error = it.message }
                    busy = false
                }
            }
            d.schedule?.let { Paragraph("建议的定时: $it", c.textSecondary, META_SP) }
        } else {
            SettingsGroup("已安装", d.schedule?.let { "建议的定时: $it" }) {
                if (installed.channel.isNotEmpty()) {
                    InfoRow("群", installed.channel)
                    RowDivider()
                }
                ActionRow(
                    if (busy) "更新中..." else if (e.outdated) "更新到 v${e.version}" else "重新拉取最新版",
                    "refresh-cw",
                    enabled = !busy,
                ) {
                    busy = true
                    scope.launch {
                        api.update(id).onSuccess { onChanged(); reload() }.onFailure { error = it.message }
                        busy = false
                    }
                }
                RowDivider()
                SwitchRow("自动更新", installed.auto, "市场出新版后, 下次打开市场或 Agent 拉指令时自动换上。群, 密钥, 待办都不变。") { on ->
                    scope.launch { api.setAuto(id, on).onSuccess { reload() }.onFailure { error = it.message } }
                }
                if (installed.channel.isNotEmpty()) {
                    RowDivider()
                    ActionRow("打开群", "message-circle") { openGroup(installed.channel) }
                }
                RowDivider()
                ActionRow("卸载", "trash-2", danger = true, enabled = !busy) { confirm = true }
            }
        }
        if (installed != null && id == GH_ID) GhSection()
        if (installed != null && id == TODO_ID && installed.channel.isNotEmpty()) TodoExtSection(installed.channel)
        d.task?.let { TaskPrompt(it, installed != null) }
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

private const val TASK_PREVIEW_LINES = 6

/** 任务提示词: 插件让 Agent 干什么, 不含密钥, 可以单独复制给任何 Agent (包括云端的)。 */
@Composable
private fun TaskPrompt(task: String, installed: Boolean) {
    var open by rememberSaveable { mutableStateOf(false) }
    val hint = if (installed) "这个插件让 Agent 干的活, 不含密钥。想换一个 Agent, 或只想看看规则, 复制这段即可; 接入本身仍用接入语。"
    else "装好后 Agent 会照这段干活 (群名按默认预览), 不含密钥。"
    SettingsGroup("任务提示词", hint) {
        NoteRow(if (open) task else task.lineSequence().take(TASK_PREVIEW_LINES).joinToString("\n") + "\n...", mono = true)
        RowDivider(indent = false)
        ActionRow(if (open) "收起" else "展开全文", if (open) "chevron-up" else "chevron-down") { open = !open }
        RowDivider(indent = false)
        CopyRow("复制任务提示词", task)
    }
}

/** 刚装完: 一段接入语整段复制给任何 Agent, 里面的间隔和任务可以直接改。只显示这一次。 */
@Composable
private fun Handoff(p: PluginInstalled) {
    SettingsGroup("接入 Agent", "整段发给 Claude Code, Codex 或云端 Agent 都行, 间隔和任务可以先改再发。里面有密钥, 只显示这一次。") {
        NoteRow(p.prompt, mono = true)
        RowDivider(indent = false)
        CopyRow("复制接入语", p.prompt)
        RowDivider(indent = false)
        CopyRow("只复制密钥", p.key)
    }
}

@Composable
private fun CopyRow(label: String, text: String) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    ActionRow(if (copied) "已复制" else label, "copy") {
        clipboard.setText(AnnotatedString(text))
        copied = true
    }
}
