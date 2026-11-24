package com.hengxin.aioa.ui

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
import com.hengxin.aioa.ui.chat.rememberAvatarPicker
import com.hengxin.aioa.ui.chat.ChatAgent
import com.hengxin.aioa.ui.chat.ChatAvatar
import com.hengxin.aioa.ui.chat.DIGEST_DAILY
import com.hengxin.aioa.ui.chat.DIGEST_WEEKLY
import com.hengxin.aioa.ui.chat.MembersCard
import com.hengxin.aioa.ui.chat.ROLE_ADMIN
import com.hengxin.aioa.ui.chat.ROLE_OWNER
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val CARD = RoundedCornerShape(14.dp)
private val BIG_AVATAR = 84.dp

// 正在显示的对话框
private sealed interface GsDialog {
    data object Rename : GsDialog
    data class EditAgent(val agent: ChatAgent?) : GsDialog
    data class Prompt(val title: String, val text: String, val note: String, val key: String? = null) : GsDialog
    data class Remove(val agent: ChatAgent) : GsDialog
    data object Clear : GsDialog
}

/** 群设置: 头像, 名称, 置顶, 免打扰, 日报 / 周报, 以及接入的 Agent。 */
@Composable
fun GroupSettingsPage(model: ChatModel, group: String, onBack: () -> Unit) {
    val g = model.groups
    val dir = g.directory
    val meta = dir.metas[group]
    // 只有自己的群没有 role, 主人就是群主; 成员看不到 Agent, 群类型与清空
    val owner = meta?.role == null || meta.role == ROLE_OWNER
    val manage = owner || meta?.role == ROLE_ADMIN
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var dialog by remember { mutableStateOf<GsDialog?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    val pickAvatar = rememberAvatarPicker({ dir.error = it }) { bytes ->
        busy = "正在上传头像..."
        Avatars.upload(context, bytes).onSuccess { dir.setAvatar(group, it) }.onFailure { dir.error = "头像上传失败: ${it.message}" }
        busy = null
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            BackButton(onBack)
            Text("群设置", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = PAD), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.clickable(enabled = manage) { pickAvatar() }) {
                    ChatAvatar(group, meta?.avatar, BIG_AVATAR)
                }
                Text(meta?.title ?: group, Modifier.padding(top = 8.dp), fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Text(busy ?: if (manage) "点头像更换 · channel: $group" else "channel: $group", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                dir.error?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error) }
            }
            Card {
                ValueRow("群名称", meta?.title ?: group) { if (manage) dialog = GsDialog.Rename }
                SwitchRow("置顶", meta?.pinned == true) { dir.setPinned(group, it) }
                SwitchRow("免打扰", meta?.muted == true, "照常收消息, 只是不响铃不弹通知") { dir.setMuted(group, it) }
            }
            if (group != MessageDb.MEMO_GROUP) Card { MembersCard(group, meta, { dir.refreshChats() }, onBack) }
            if (owner) Card {
                Text("群类型", fontSize = 15.sp)
                Text("标成日报 / 周报后, 其它群的消息长按可以 \"收录\" 到这里, 精选 Agent 也可以直接往这里发报告。", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(null to "普通", DIGEST_DAILY to "日报", DIGEST_WEEKLY to "周报").forEach { (k, label) ->
                        FilterChip(meta?.digest == k, { dir.setDigest(group, k) }, { Text(label) })
                    }
                }
            }
            if (owner && group != MessageDb.MEMO_GROUP) AgentsCard(meta?.agents.orEmpty(), { dialog = GsDialog.EditAgent(null) }) { agent, action ->
                when (action) {
                    AgentAction.COPY -> scope.launch {
                        dir.savedPrompt(group, agent.keyId)
                            .onSuccess { dialog = GsDialog.Prompt("${agent.name} 的指令", it, "这是服务端下发给它的完整指令 (不含密钥), 它报到时拉的就是这份。改了可读的群后它会自己重新拉取。") }
                            .onFailure { dir.error = it.message }
                    }
                    AgentAction.ROTATE -> scope.launch {
                        dir.rotate(group, agent.keyId)
                            .onSuccess { dialog = GsDialog.Prompt("发给 ${agent.name}", it.prompt, "旧密钥已作废。整段发给 Agent 即可, 任务可以先改再发。密钥只显示这一次。", it.key) }
                            .onFailure { dir.error = it.message }
                    }
                    AgentAction.EDIT -> dialog = GsDialog.EditAgent(agent)
                    AgentAction.REMOVE -> dialog = GsDialog.Remove(agent)
                }
            }
            if (owner) Card {
                Row(Modifier.fillMaxWidth().clickable { dialog = GsDialog.Clear }.padding(vertical = 8.dp)) {
                    Text("清空聊天记录", fontSize = 15.sp, color = MaterialTheme.colorScheme.error)
                }
            }
            Box(Modifier.heightIn(min = 24.dp))
        }
    }
    when (val d = dialog) {
        GsDialog.Rename -> NameDialog("群名称", meta?.title ?: group, { dialog = null }) { dir.rename(group, it); true }
        is GsDialog.EditAgent -> AgentDialog(model, group, d.agent, { dialog = null }) { name, reads ->
            scope.launch {
                if (d.agent == null) {
                    dir.addAgent(group, name, reads)
                        .onSuccess { dialog = GsDialog.Prompt("发给 $name", it.prompt, "整段发给你的 Agent, 它会按文档接入并报到, 任务可以先改再发。密钥只显示这一次。", it.key) }
                        .onFailure { dir.error = it.message; dialog = null }
                } else {
                    dir.editAgent(group, d.agent.keyId, name, reads)?.let { dir.error = it }
                    dialog = null
                }
            }
        }
        is GsDialog.Prompt -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text(d.title) },
            text = {
                Column {
                    Text(d.note, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                    Box(Modifier.padding(top = 8.dp).heightIn(max = 320.dp).background(MaterialTheme.colorScheme.surfaceVariant, CARD).verticalScroll(rememberScrollState()).padding(10.dp)) {
                        SelectionContainer { Text(d.text, fontFamily = FontFamily.Monospace, fontSize = 12.sp) }
                    }
                    Row {
                        d.key?.takeIf { it.isNotEmpty() }?.let { k -> TextButton({ clipboard.setText(AnnotatedString(k)) }) { Text("只复制密钥") } }
                    }
                }
            },
            confirmButton = { TextButton({ clipboard.setText(AnnotatedString(d.text)); dialog = null }) { Text("复制接入语") } },
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
        if (agents.isEmpty()) Text("起个名字, 勾上它能读的群, 就会得到一句话。发给你的 Agent, 它会自己拉取规则并报到, 之后你在它那边布置任务, 结果发到这个群。", fontSize = 12.sp, color = c.outline)
        agents.forEach { a ->
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(a.name, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                Text(joinState(a), fontSize = 12.sp, color = if (a.joined != null && !a.pending) c.primary else c.outline)
                if (a.reads.isNotEmpty()) Text("可读: ${a.reads.joinToString(", ")}", fontSize = 12.sp, color = c.outline)
                Row {
                    TextButton({ onAction(a, AgentAction.COPY) }) { Text("查看指令") }
                    TextButton({ onAction(a, AgentAction.ROTATE) }) { Text("重新接入") }
                    TextButton({ onAction(a, AgentAction.EDIT) }) { Text("编辑") }
                    TextButton({ onAction(a, AgentAction.REMOVE) }) { Text("移除", color = c.error) }
                }
            }
        }
    }
}

private fun joinState(a: ChatAgent): String = when {
    a.joined == null -> "还没报到: 把那句话发给它"
    a.pending -> "指令已更新, 等它重新拉取后报到"
    else -> "已接入 · ${SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(Date(a.joined))} 报到"
}

/** 接入或编辑 Agent: 名字和可读的群, 指令由服务端生成。 */
@Composable
private fun AgentDialog(model: ChatModel, group: String, agent: ChatAgent?, close: () -> Unit, ok: (String, List<String>) -> Unit) {
    var name by remember { mutableStateOf(agent?.name ?: "") }
    var reads by remember { mutableStateOf(agent?.reads?.toSet() ?: emptySet()) }
    val groups = remember { model.groups.rows().map { it.key }.filter { it != MessageDb.MEMO_GROUP } }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(if (agent == null) "接入 Agent" else "编辑 ${agent.name}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("名字") }, singleLine = true)
                Text("允许读这些群的消息", Modifier.padding(top = 10.dp), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                groups.forEach { k ->
                    Row(Modifier.fillMaxWidth().clickable { reads = if (k in reads) reads - k else reads + k }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(k in reads, { reads = if (it) reads + k else reads - k })
                        Text(if (k == group) "$k (本群)" else model.groups.directory.title(k), fontSize = 14.sp)
                    }
                }
            }
        },
        confirmButton = { TextButton({ if (name.isNotBlank()) ok(name, reads.toList()) }, enabled = name.isNotBlank()) { Text(if (agent == null) "生成接入语" else "保存") } },
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
