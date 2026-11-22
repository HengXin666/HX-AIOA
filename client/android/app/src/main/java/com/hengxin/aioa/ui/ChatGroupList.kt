package com.hengxin.aioa.ui

import android.text.format.DateFormat
import android.text.format.DateUtils
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.data.GroupSummary
import com.hengxin.aioa.data.MessageDb

private const val UNGROUPED = "未分组"
private const val BADGE_MAX = 99
private val AVATAR = 42.dp

// 正在操作的对象: 给某个群挪组, 新建组, 或删除某个组
private sealed interface Dialog {
    data class Move(val group: String) : Dialog
    data object NewFolder : Dialog
    data class DropFolder(val name: String) : Dialog
}

/** 群列表: 组在上 (可收起), 未分组的在下; 长按群可以挪到别的组, 长按组标题可删组。 */
@Composable
fun GroupList(model: ChatModel) {
    val g = model.groups
    var dialog by remember { mutableStateOf<Dialog?>(null) }
    var collapsed by rememberSaveable { mutableStateOf(emptyList<String>()) }
    val byKey = g.summaries.associateBy { it.key }
    val grouped = g.folders.flatMap { it.groups }.toSet()
    val loose = g.summaries.filter { it.key !in grouped }
    Column(Modifier.fillMaxSize()) {
        Header("消息", model.online) {
            TextButton({ dialog = Dialog.NewFolder }) { Text("新建组") }
        }
        g.error?.let { Text(it, Modifier.padding(horizontal = PAD), fontSize = 12.sp, color = MaterialTheme.colorScheme.error) }
        if (g.summaries.isEmpty() && g.folders.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("还没有消息。推送时带上 channel 就会进对应的群。", color = MaterialTheme.colorScheme.outline, fontSize = 13.sp)
            }
            return@Column
        }
        LazyColumn(Modifier.fillMaxWidth()) {
            g.folders.forEach { f ->
                val rows = f.groups.mapNotNull { byKey[it] }.sortedByDescending { it.last.seq }
                val shut = f.name in collapsed
                item(key = "f:${f.name}") {
                    FolderHeader(f.name, rows.sumOf { it.unread }, shut, { collapsed = if (shut) collapsed - f.name else collapsed + f.name }) {
                        dialog = Dialog.DropFolder(f.name)
                    }
                }
                if (!shut) rows.forEach { s -> item(key = "g:${s.key}") { GroupRow(s, { g.openGroup(s.key) }) { dialog = Dialog.Move(s.key) } } }
            }
            if (g.folders.isNotEmpty() && loose.isNotEmpty()) item(key = "loose") { FolderHeader(UNGROUPED, 0, false, null, null) }
            loose.forEach { s -> item(key = "g:${s.key}") { GroupRow(s, { g.openGroup(s.key) }) { dialog = Dialog.Move(s.key) } } }
        }
    }
    when (val d = dialog) {
        is Dialog.Move -> MoveDialog(d.group, g) { dialog = null }
        Dialog.NewFolder -> NameDialog("新建组", { dialog = null }) { g.addFolder(it) }
        is Dialog.DropFolder -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("删除组 \"${d.name}\"?") },
            text = { Text("组里的群会回到未分组, 消息不受影响。") },
            confirmButton = { TextButton({ g.removeFolder(d.name); dialog = null }) { Text("删除") } },
            dismissButton = { TextButton({ dialog = null }) { Text("取消") } },
        )
        null -> Unit
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FolderHeader(name: String, unread: Int, collapsed: Boolean, onToggle: (() -> Unit)?, onLong: (() -> Unit)?) {
    val c = MaterialTheme.colorScheme
    val mod = if (onToggle != null) Modifier.combinedClickable(onClick = onToggle, onLongClick = onLong) else Modifier
    Row(mod.fillMaxWidth().background(c.surfaceVariant.copy(alpha = 0.5f)).padding(horizontal = PAD, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onToggle != null) Text(if (collapsed) "▸ " else "▾ ", fontSize = 12.sp, color = c.outline)
        Text(name, Modifier.weight(1f), fontSize = 12.sp, color = c.outline, fontWeight = FontWeight.Medium)
        if (collapsed && unread > 0) Badge(unread)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GroupRow(s: GroupSummary, onOpen: () -> Unit, onLong: () -> Unit) {
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().combinedClickable(onClick = onOpen, onLongClick = onLong).padding(horizontal = PAD, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(AVATAR).background(c.primaryContainer, CircleShape), contentAlignment = Alignment.Center) {
            Text(avatarOf(s.key), color = c.onPrimaryContainer, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(s.key, Modifier.weight(1f), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(timeOf(s.last.ts), fontSize = 11.sp, color = c.outline)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val who = if (s.key == s.last.src || s.key == MessageDb.MEMO_GROUP) "" else "${s.last.src}: "
                Text(who + s.last.text, Modifier.weight(1f), fontSize = 13.sp, color = c.outline, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (s.unread > 0) Badge(s.unread)
            }
        }
    }
}

@Composable
private fun Badge(n: Int) {
    Box(Modifier.padding(start = 6.dp).background(MaterialTheme.colorScheme.error, CircleShape).padding(horizontal = 6.dp, vertical = 1.dp)) {
        Text(if (n > BADGE_MAX) "$BADGE_MAX+" else "$n", color = MaterialTheme.colorScheme.onError, fontSize = 11.sp)
    }
}

@Composable
private fun MoveDialog(group: String, g: ChatGroups, close: () -> Unit) {
    var creating by remember { mutableStateOf(false) }
    if (creating) {
        NameDialog("新建组并移入", close) { name -> g.addFolder(name).also { if (it) g.moveTo(group, name) } }
        return
    }
    val current = g.folderOf(group)
    AlertDialog(
        onDismissRequest = close,
        title = { Text("把 \"$group\" 移到") },
        text = {
            Column {
                g.folders.forEach { f ->
                    val mark = if (f.name == current) "✓ " else ""
                    Text(mark + f.name, Modifier.fillMaxWidth().clickable { g.moveTo(group, f.name); close() }.padding(vertical = 10.dp))
                }
                if (current != null) Text(UNGROUPED, Modifier.fillMaxWidth().clickable { g.moveTo(group, null); close() }.padding(vertical = 10.dp))
                Text("+ 新建组", Modifier.fillMaxWidth().clickable { creating = true }.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.primary)
            }
        },
        confirmButton = { TextButton(close) { Text("取消") } },
    )
}

/** 输入名字的对话框; ok 返回 false 表示重名或为空, 不关闭。 */
@Composable
private fun NameDialog(title: String, close: () -> Unit, ok: (String) -> Boolean) {
    var name by remember { mutableStateOf("") }
    var bad by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it; bad = false }, singleLine = true, isError = bad, placeholder = { Text("例如 邮件") }) },
        confirmButton = { TextButton({ if (ok(name)) close() else bad = true }) { Text("确定") } },
        dismissButton = { TextButton(close) { Text("取消") } },
    )
}

private fun avatarOf(key: String): String = key.substringAfterLast('/').trim().take(1).uppercase().ifEmpty { "#" }

@Composable
private fun timeOf(ts: Long): String {
    val context = LocalContext.current
    return if (DateUtils.isToday(ts)) DateFormat.getTimeFormat(context).format(ts)
    else DateUtils.formatDateTime(context, ts, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH)
}
