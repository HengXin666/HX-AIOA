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
    data object Clear : GsDialog
    data object Delete : GsDialog
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
                ValueRow("群名称", (meta?.title ?: group) + if (manage) "  ›" else "") { if (manage) dialog = GsDialog.Rename }
                SwitchRow("置顶", meta?.pinned == true) { dir.setPinned(group, it) }
                SwitchRow("免打扰", meta?.muted == true, "照常收消息, 只是不响铃不弹通知") { dir.setMuted(group, it) }
                if (owner && meta?.isMail != true && group != MessageDb.MEMO_GROUP) {
                    SwitchRow("信息流展示", meta?.isFeed == true, "推送卡片按条目平铺, 有今天 / 全部 / 收藏, 适合福利, 资讯类群") { dir.setFeed(group, it) }
                }
            }
            // 实时状态提示: 群主 / 管理员可关, 关了服务端不再推这类帧
            if (group != MessageDb.MEMO_GROUP && (meta?.canTune ?: true)) Card {
                SwitchRow("显示 Agent 正在监听", meta?.hideListening != true, "Agent 长连或最近拉过消息时, 群顶显示它在听") { dir.setHideListening(group, !it) }
                SwitchRow("显示正在输入", meta?.hideTyping != true, "关掉后大家都不再上报和显示 \"正在输入\"") { dir.setHideTyping(group, !it) }
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
            if (owner && group != MessageDb.MEMO_GROUP) Card { com.hengxin.aioa.ui.agents.AgentsSection(model, group, meta?.agents.orEmpty()) }
            if (owner) Card {
                Row(Modifier.fillMaxWidth().clickable { dialog = GsDialog.Clear }.padding(vertical = 8.dp)) {
                    Text("清空聊天记录", fontSize = 15.sp, color = MaterialTheme.colorScheme.error)
                }
                if (group != MessageDb.MEMO_GROUP) Row(Modifier.fillMaxWidth().clickable { dialog = GsDialog.Delete }.padding(vertical = 8.dp)) {
                    Text("删除群", fontSize = 15.sp, color = MaterialTheme.colorScheme.error)
                }
            }
            Box(Modifier.heightIn(min = 24.dp))
        }
    }
    when (val d = dialog) {
        GsDialog.Rename -> NameDialog("群名称", group, { dialog = null }, meta?.title ?: group) { dir.rename(group, it); true }
        GsDialog.Delete -> DeleteGroupDialog(g, group) { dialog = null }
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
