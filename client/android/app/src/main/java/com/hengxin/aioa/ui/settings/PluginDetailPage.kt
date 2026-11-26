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
import androidx.compose.runtime.collectAsState
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
// 服务端返回新 id (旧 id gh / todo 只作路径别名)
private const val GH_ID = "hengxin666.gh"
private const val TODO_ID = "hengxin666.todo"

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
    // 待确认的高危操作: 放行 (allow) 或启用 (enable)
    var risky by remember { mutableStateOf<String?>(null) }
    val reload = {
        scope.launch {
            api.detail(id).onSuccess { detail = it; error = null }.onFailure { error = it.message }
        }
    }
    val pushed by PluginEvents.rev.collectAsState()
    val compat by PluginEvents.compat.collectAsState()
    // 低于支持窗口时新功能灰掉: 只能看, 不能放行 / 启用 / 安装
    val limited = compat?.limited == true
    LaunchedEffect(id, pushed) { reload() }
    val perform = { block: suspend () -> Result<Unit> ->
        busy = true
        scope.launch {
            block().onSuccess { onChanged(); reload() }.onFailure { error = it.message }
            busy = false
        }
    }
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
                val ver = when {
                    e.outdated -> "已装 v${e.installed?.version}, 已放行 v${e.allowed?.version}"
                    e.allowed == null -> "v${e.version} · 待放行"
                    else -> "v${e.allowed.version}"
                }
                Text(listOf(ver, e.author).filter { it.isNotEmpty() }.joinToString(" · "), c.textSecondary, META_SP)
            }
        }
        if (e.summary.isNotEmpty()) Paragraph(e.summary, c.text, BODY_SP + 1)
        e.sourceName?.let { SettingsGroup { NoteRow("来自第三方市场源 $it, 内容由源的作者维护, 放行前看清它要的权限。", c.textSecondary) } }
        if (d.gone) SettingsGroup { NoteRow("市场里已经没有这个插件, 这里是放行时存下的版本, 可以撤销或卸载。", c.textSecondary) }
        val installed = e.installed
        val p = prompt
        if (p != null) Handoff(p)
        if (limited) SettingsGroup { NoteRow(compat?.msg ?: "App 版本过旧, 请更新", c.danger) }
        if (e.dev && d.admin) {
            val hint = if (e.foreign) "别的管理员在开发模式下装的本地插件, 只有开发者能用。主人可以撤掉它 (比如开发者已经不是管理员)。"
            else "开发模式装的本地插件, 只有你看得到。重新上传即换版本, 装了 Agent 的会立即换上新提示词。"
            SettingsGroup(if (e.foreign) "别人开发中" else "开发中", hint) {
                ActionRow("撤掉", "trash-2", danger = true, enabled = !busy) {
                    busy = true
                    // 成功后再离开, 离开页面会取消这里的协程
                    scope.launch { (if (e.foreign) api.revoke(id) else api.devRemove(id)).onSuccess { onChanged(); onBack() }.onFailure { error = it.message; busy = false } }
                }
            }
        } else AllowGroup(d, busy || limited) { act ->
            if (act && d.risky.isNotEmpty()) { risky = ACT_ALLOW } else { perform { if (act) api.allow(id, d.digest) else api.revoke(id) } }
        }
        if (e.foreign) {
            Paragraph("这是别人的开发插件, 只能撤掉, 不能启用或安装。", c.textSecondary, BODY_SP)
        } else if (installed == null && e.allowed == null) {
            if (!d.admin) Paragraph("管理员还没放行这个插件, 放行后才能启用。", c.textSecondary, BODY_SP)
        } else if (d.agentless || !d.owner) {
            EnableGroup(d, !busy && !limited) { on -> if (on && d.risky.isNotEmpty()) { risky = ACT_ENABLE } else { perform { api.setEnabled(id, on) } } }
        } else if (installed == null) {
            PrimaryAction(if (busy) "安装中..." else "安装", enabled = !busy && !limited) {
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
                    if (busy) "更新中..." else if (e.outdated) "更新到 v${e.allowed?.version}" else "重新应用放行的版本",
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
                SwitchRow("自动更新", installed.auto, "管理员放行新版后自动换上, Agent 长连会立即收到。群, 密钥, 待办都不变。") { on ->
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
        ChoiceGroup(d, !busy && !limited) { point, plugin -> perform { api.choose(point, plugin) }; Unit }
        // GitHub 授权没有 Agent: 启用后在这里授权
        if (id == GH_ID && d.enabled) GhSection()
        if (installed != null && id == TODO_ID && installed.channel.isNotEmpty()) TodoExtSection(installed.channel)
        d.task?.let { TaskPrompt(it, installed != null) }
        Column(Modifier.fillMaxWidth().clip(README_SHAPE).background(c.surface).padding(16.dp)) {
            if (d.html) HtmlCard(d.readme, maxHeight = README_MAX)
            else MarkdownText(d.readme, MdColors(c.text, c.textSecondary, c.accent, c.surfaceAlt))
        }
    }
    risky?.let { act ->
        RiskyDialog(d?.entry?.name.orEmpty(), if (act == ACT_ALLOW) "放行" else "启用", d?.risky.orEmpty(), { risky = null }) {
            perform { if (act == ACT_ALLOW) api.allow(id, d?.digest) else api.setEnabled(id, true) }
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
private const val ACT_ALLOW = "allow"
private const val ACT_ENABLE = "enable"

/** 管理员才看到: 放行 (或放行市场新版) 与撤销放行。act = true 放行, false 撤销。 */
@Composable
private fun AllowGroup(d: PluginDetail, busy: Boolean, onAct: (Boolean) -> Unit) {
    if (!d.admin) return
    val e = d.entry
    val risky = e.allowed?.risky.orEmpty()
    val hint = if (risky.isEmpty()) "放行后所有账号都能自己启用; 白名单里每个插件只有一个版本。" else "含高危权限: ${risky.joinToString(", ")}。"
    SettingsGroup("管理员", hint) {
        if (e.pending) {
            ActionRow(if (e.allowed == null) "放行 v${e.version}" else "放行新版 v${e.version}", "shield-check", enabled = !busy) { onAct(true) }
            if (e.allowed != null) RowDivider()
        }
        if (e.allowed != null) ActionRow("撤销放行", "shield-off", danger = true, enabled = !busy) { onAct(false) }
    }
}

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
