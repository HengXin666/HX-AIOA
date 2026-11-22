package com.hengxin.aioa.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.ui.chat.Avatars
import com.hengxin.aioa.ui.chat.ChatAgent
import com.hengxin.aioa.ui.chat.ChatAvatar
import com.hengxin.aioa.ui.chat.DIGEST_DAILY
import com.hengxin.aioa.ui.chat.DIGEST_WEEKLY
import kotlinx.coroutines.launch

private val CARD = RoundedCornerShape(14.dp)
private val BIG_AVATAR = 84.dp

// 正在显示的对话框
private sealed interface GsDialog {
    data object Rename : GsDialog
    data class EditAgent(val agent: ChatAgent?) : GsDialog
    data class Prompt(val title: String, val text: String, val note: String) : GsDialog
    data class Remove(val agent: ChatAgent) : GsDialog
    data object Clear : GsDialog
}

/** 群设置: 头像, 名称, 置顶, 免打扰, 日报 / 周报, 以及接入的 Agent。 */
@Composable
fun GroupSettingsPage(model: ChatModel, group: String, onBack: () -> Unit) {
    val g = model.groups
    val dir = g.directory
    val meta = dir.metas[group]
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var dialog by remember { mutableStateOf<GsDialog?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = "正在上传头像..."
        scope.launch {
            val bytes = Avatars.encode(context, uri)
            val r = bytes?.let { Avatars.upload(context, it) } ?: Result.failure(Exception("读不了这张图片"))
            r.onSuccess { dir.setAvatar(group, it) }.onFailure { dir.error = "头像上传失败: ${it.message}" }
            busy = null
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            BackButton(onBack)
            Text("群设置", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = PAD), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.clickable { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                    ChatAvatar(group, meta?.avatar, BIG_AVATAR)
                }
                Text(meta?.title ?: group, Modifier.padding(top = 8.dp), fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Text(busy ?: "点头像更换 · channel: $group", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                dir.error?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error) }
            }
            Card {
                ValueRow("群名称", meta?.title ?: group) { dialog = GsDialog.Rename }
                SwitchRow("置顶", meta?.pinned == true) { dir.setPinned(group, it) }
                SwitchRow("免打扰", meta?.muted == true, "照常收消息, 只是不响铃不弹通知") { dir.setMuted(group, it) }
            }
            Card {
                Text("群类型", fontSize = 15.sp)
                Text("标成日报 / 周报后, 其它群的消息长按可以 \"收录\" 到这里, 精选 Agent 也可以直接往这里发报告。", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(null to "普通", DIGEST_DAILY to "日报", DIGEST_WEEKLY to "周报").forEach { (k, label) ->
                        FilterChip(meta?.digest == k, { dir.setDigest(group, k) }, { Text(label) })
                    }
                }
            }
            if (group != MessageDb.MEMO_GROUP) AgentsCard(meta?.agents.orEmpty(), { dialog = GsDialog.EditAgent(null) }) { agent, action ->
                when (action) {
                    AgentAction.COPY -> scope.launch {
                        dir.savedPrompt(group, agent.keyId)
                            .onSuccess { dialog = GsDialog.Prompt(agent.name, it, "这份不含密钥: 原来的 Agent 还活着时用来提醒它怎么干活; 要重新接入请点 \"重新接入\"。") }
                            .onFailure { dir.error = it.message }
                    }
                    AgentAction.ROTATE -> scope.launch {
                        dir.rotate(group, agent.keyId)
                            .onSuccess { dialog = GsDialog.Prompt(agent.name, it.prompt, "旧密钥已作废。把这段整个发给 Agent 就能重新接入, 密钥只显示这一次。") }
                            .onFailure { dir.error = it.message }
                    }
                    AgentAction.EDIT -> dialog = GsDialog.EditAgent(agent)
                    AgentAction.REMOVE -> dialog = GsDialog.Remove(agent)
                }
            }
            Card {
                Row(Modifier.fillMaxWidth().clickable { dialog = GsDialog.Clear }.padding(vertical = 8.dp)) {
                    Text("清空聊天记录", fontSize = 15.sp, color = MaterialTheme.colorScheme.error)
                }
            }
            Box(Modifier.heightIn(min = 24.dp))
        }
    }
    when (val d = dialog) {
        GsDialog.Rename -> NameDialog("群名称", meta?.title ?: group, { dialog = null }) { dir.rename(group, it); true }
        is GsDialog.EditAgent -> AgentDialog(model, group, d.agent, { dialog = null }) { name, brief, reads ->
            scope.launch {
                if (d.agent == null) {
                    dir.addAgent(group, name, brief, reads)
                        .onSuccess { dialog = GsDialog.Prompt(name, it.prompt, "把这段整个发给 Agent 就能接入。密钥只显示这一次, 使唤提示词已存到服务端, 之后随时可以重新接入。") }
                        .onFailure { dir.error = it.message; dialog = null }
                } else {
                    dir.editAgent(group, d.agent.keyId, name, brief, reads)?.let { dir.error = it }
                    dialog = null
                }
            }
        }
        is GsDialog.Prompt -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("给 ${d.title} 的提示词") },
            text = {
                Column {
                    Text(d.note, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                    Box(Modifier.padding(top = 8.dp).heightIn(max = 320.dp).background(MaterialTheme.colorScheme.surfaceVariant, CARD).verticalScroll(rememberScrollState()).padding(10.dp)) {
                        SelectionContainer { Text(d.text, fontFamily = FontFamily.Monospace, fontSize = 12.sp) }
                    }
                }
            },
            confirmButton = { TextButton({ clipboard.setText(AnnotatedString(d.text)); dialog = null }) { Text("一键复制") } },
            dismissButton = { TextButton({ dialog = null }) { Text("关闭") } },
        )
        is GsDialog.Remove -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("移除 ${d.agent.name}?") },
            text = { Text("它的密钥会立即作废, 已发的消息保留。") },
            confirmButton = { TextButton({ scope.launch { dir.removeAgent(group, d.agent.keyId)?.let { dir.error = it } }; dialog = null }) { Text("移除") } },
            dismissButton = { TextButton({ dialog = null }) { Text("取消") } },
        )
        GsDialog.Clear -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("清空聊天记录?") },
            text = { Text("服务端和所有设备上这个群的消息都会删掉, 收藏不受影响, 群资料与 Agent 保留。") },
            confirmButton = {
                TextButton({
                    dialog = null
                    busy = "正在清空..."
                    g.clearHistory(group) { err -> busy = null; err?.let { dir.error = "清空失败: $it" } }
                }) { Text("清空", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton({ dialog = null }) { Text("取消") } },
        )
        null -> Unit
    }
}

private enum class AgentAction { COPY, ROTATE, EDIT, REMOVE }

@Composable
private fun AgentsCard(agents: List<ChatAgent>, onAdd: () -> Unit, onAction: (ChatAgent, AgentAction) -> Unit) {
    val c = MaterialTheme.colorScheme
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Agent", Modifier.weight(1f), fontSize = 15.sp)
            TextButton(onAdd) { Text("+ 接入 Agent") }
        }
        if (agents.isEmpty()) Text("接入后会得到一段提示词, 复制给你的 Agent, 它就能往这个群发消息 (也可以授权它读别的群, 用来做精选)。", fontSize = 12.sp, color = c.outline)
        agents.forEach { a ->
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(a.name, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                Text(a.brief.ifBlank { "还没写使唤提示词" }, fontSize = 12.sp, color = c.outline, maxLines = 2)
                if (a.reads.isNotEmpty()) Text("可读: ${a.reads.joinToString(", ")}", fontSize = 12.sp, color = c.outline)
                Row {
                    TextButton({ onAction(a, AgentAction.COPY) }) { Text("复制提示词") }
                    TextButton({ onAction(a, AgentAction.ROTATE) }) { Text("重新接入") }
                    TextButton({ onAction(a, AgentAction.EDIT) }) { Text("编辑") }
                    TextButton({ onAction(a, AgentAction.REMOVE) }) { Text("移除", color = c.error) }
                }
            }
        }
    }
}

/** 接入或编辑 Agent: 名字, 使唤提示词, 可读的群。 */
@Composable
private fun AgentDialog(model: ChatModel, group: String, agent: ChatAgent?, close: () -> Unit, ok: (String, String, List<String>) -> Unit) {
    var name by remember { mutableStateOf(agent?.name ?: "") }
    var brief by remember { mutableStateOf(agent?.brief ?: "") }
    var reads by remember { mutableStateOf(agent?.reads?.toSet() ?: emptySet()) }
    val groups = remember { model.groups.rows().map { it.key }.filter { it != MessageDb.MEMO_GROUP } }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(if (agent == null) "接入 Agent" else "编辑 ${agent.name}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("名字") }, singleLine = true)
                OutlinedTextField(
                    brief,
                    { brief = it },
                    Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 120.dp),
                    label = { Text("使唤提示词: 让它做什么, 多久一次") },
                    placeholder = { Text("例如: 每天 8 点汇总 Hacker News 前 10 条, 每条一句中文点评") },
                )
                Text("允许读这些群的消息", Modifier.padding(top = 10.dp), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                groups.forEach { k ->
                    Row(Modifier.fillMaxWidth().clickable { reads = if (k in reads) reads - k else reads + k }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(k in reads, { reads = if (it) reads + k else reads - k })
                        Text(if (k == group) "$k (本群)" else model.groups.directory.title(k), fontSize = 14.sp)
                    }
                }
            }
        },
        confirmButton = { TextButton({ if (name.isNotBlank()) ok(name, brief, reads.toList()) }, enabled = name.isNotBlank()) { Text(if (agent == null) "生成提示词" else "保存") } },
        dismissButton = { TextButton(close) { Text("取消") } },
    )
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f), CARD).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        content()
    }
}

@Composable
private fun ValueRow(label: String, value: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontSize = 15.sp)
        Text(value, fontSize = 14.sp, color = MaterialTheme.colorScheme.outline, maxLines = 1)
    }
}

@Composable
private fun SwitchRow(label: String, on: Boolean, hint: String? = null, set: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 15.sp)
            hint?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline) }
        }
        Switch(on, set)
    }
}
