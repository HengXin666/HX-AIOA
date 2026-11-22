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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.ui.chat.ChatAvatar
import com.hengxin.aioa.ui.chat.digestLabel
import com.hengxin.aioa.ui.chat.plainPreview

private const val UNGROUPED = "未分组"
private const val BADGE_MAX = 99
private val AVATAR = 48.dp

// 正在操作的对象: 给某个群挪组, 新建群, 新建组, 或删除某个组
private sealed interface Dialog {
    data class Move(val group: String) : Dialog
    data object NewGroup : Dialog
    data object NewFolder : Dialog
    data class DropFolder(val name: String) : Dialog
}

/** 群列表: 置顶在前, 组在上 (可收起), 未分组的在下; 长按群挪组, 长按组标题删组。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupList(model: ChatModel) {
    val g = model.groups
    var dialog by remember { mutableStateOf<Dialog?>(null) }
    var menu by remember { mutableStateOf(false) }
    var collapsed by rememberSaveable { mutableStateOf(emptyList<String>()) }
    val rows = g.rows()
    val byKey = rows.associateBy { it.key }
    val grouped = g.folders.flatMap { it.groups }.toSet()
    val loose = rows.filter { it.key !in grouped }
    Column(Modifier.fillMaxSize()) {
        Header("消息", model.online) {
            Box {
                Box(Modifier.size(36.dp).clickable { menu = true }, contentAlignment = Alignment.Center) {
                    Text("+", fontSize = 24.sp, color = MaterialTheme.colorScheme.onSurface)
                }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem({ Text("新建群") }, { dialog = Dialog.NewGroup; menu = false })
                    DropdownMenuItem({ Text("新建组") }, { dialog = Dialog.NewFolder; menu = false })
                }
            }
        }
        val err = g.error ?: g.directory.error
        if (err != null) Text(err, Modifier.clickable { g.clearError() }.padding(horizontal = PAD), fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
        PullToRefreshBox(g.syncing, g::syncNow, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize()) {
            item(key = "fav") { FavoritesRow(g.directory.favorites.size) { g.favoritesOpen = true } }
            g.folders.forEach { f ->
                val inFolder = f.groups.mapNotNull { byKey[it] }.sortedWith(compareByDescending<GroupRowData> { it.pinned }.thenByDescending { it.order })
                val shut = f.name in collapsed
                item(key = "f:${f.name}") {
                    FolderHeader(Modifier.animateItem(), f.name, inFolder.sumOf { if (it.muted) 0 else it.unread }, shut, { collapsed = if (shut) collapsed - f.name else collapsed + f.name }) {
                        dialog = Dialog.DropFolder(f.name)
                    }
                }
                if (!shut) inFolder.forEach { r -> item(key = "g:${r.key}") { GroupRow(Modifier.animateItem(), r, { g.openGroup(r.key) }) { dialog = Dialog.Move(r.key) } } }
            }
            if (g.folders.isNotEmpty() && loose.isNotEmpty()) item(key = "loose") { FolderHeader(Modifier, UNGROUPED, 0, false, null, null) }
            loose.forEach { r -> item(key = "g:${r.key}") { GroupRow(Modifier.animateItem(), r, { g.openGroup(r.key) }) { dialog = Dialog.Move(r.key) } } }
            if (rows.isEmpty()) item(key = "empty") {
                Text(
                    "还没有群。右上角 + 新建群, 再在群设置里接入 Agent; 推送时带上 channel 也会自动进对应的群。",
                    Modifier.padding(24.dp),
                    color = MaterialTheme.colorScheme.outline,
                    fontSize = 13.sp,
                )
            }
        }
        }
    }
    when (val d = dialog) {
        is Dialog.Move -> MoveDialog(d.group, g) { dialog = null }
        Dialog.NewGroup -> NameDialog("新建群", "例如 新闻", { dialog = null }) { name ->
            g.directory.createGroup(name).also { if (it) g.openGroup(name.trim()) }
        }
        Dialog.NewFolder -> NameDialog("新建组", "例如 工作", { dialog = null }) { g.addFolder(it) }
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

@Composable
private fun FavoritesRow(count: Int, onOpen: () -> Unit) {
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = PAD, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(AVATAR).background(c.primary, CircleShape), contentAlignment = Alignment.Center) { Icon("star", c.onPrimary, 22.dp) }
        Column(Modifier.weight(1f)) {
            Text("收藏", fontSize = 16.sp, fontWeight = FontWeight.Medium)
            Text(if (count == 0) "长按消息可以收藏" else "$count 条", fontSize = 13.sp, color = c.outline)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FolderHeader(modifier: Modifier, name: String, unread: Int, collapsed: Boolean, onToggle: (() -> Unit)?, onLong: (() -> Unit)?) {
    val c = MaterialTheme.colorScheme
    val mod = if (onToggle != null) modifier.combinedClickable(onClick = onToggle, onLongClick = onLong) else modifier
    Row(mod.fillMaxWidth().background(c.surfaceVariant.copy(alpha = 0.5f)).padding(horizontal = PAD, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onToggle != null) Text(if (collapsed) "▸ " else "▾ ", fontSize = 12.sp, color = c.outline)
        Text(name, Modifier.weight(1f), fontSize = 12.sp, color = c.outline, fontWeight = FontWeight.Medium)
        if (collapsed && unread > 0) Badge(unread, false)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GroupRow(modifier: Modifier, r: GroupRowData, onOpen: () -> Unit, onLong: () -> Unit) {
    val c = MaterialTheme.colorScheme
    Row(
        modifier.fillMaxWidth()
            .background(if (r.pinned) c.surfaceVariant.copy(alpha = 0.35f) else c.surface)
            .combinedClickable(onClick = onOpen, onLongClick = onLong)
            .padding(horizontal = PAD, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ChatAvatar(r.key, r.meta?.avatar, AVATAR)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            // 名字区占满剩余宽度, 时间始终贴右
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Text(r.meta?.title ?: r.key, Modifier.weight(1f, fill = false), fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    digestLabel(r.meta?.digest)?.let { Tag(it) }
                }
                r.last?.let { Text(timeOfDay(it.ts), Modifier.padding(start = 8.dp), fontSize = 11.sp, color = c.outline) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val last = r.last
                val who = if (last == null || r.key == last.src || r.key == MessageDb.MEMO_GROUP) "" else "${last.src}: "
                val preview = last?.let { who + plainPreview(it.text) } ?: "还没有消息"
                Text(preview, Modifier.weight(1f), fontSize = 13.sp, color = c.outline, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (r.muted) Text("🔕", fontSize = 11.sp, modifier = Modifier.padding(start = 4.dp))
                if (r.unread > 0) Badge(r.unread, r.muted)
            }
        }
    }
}

@Composable
private fun Tag(text: String) {
    val c = MaterialTheme.colorScheme
    Text(text, Modifier.padding(start = 6.dp).background(c.primary.copy(alpha = 0.12f), CircleShape).padding(horizontal = 6.dp, vertical = 1.dp), fontSize = 10.sp, color = c.primary)
}

@Composable
private fun Badge(n: Int, quiet: Boolean) {
    val c = MaterialTheme.colorScheme
    Box(Modifier.padding(start = 6.dp).background(if (quiet) c.outline else c.error, CircleShape).padding(horizontal = 6.dp, vertical = 1.dp)) {
        Text(if (n > BADGE_MAX) "$BADGE_MAX+" else "$n", color = c.onError, fontSize = 11.sp)
    }
}

@Composable
private fun MoveDialog(group: String, g: ChatGroups, close: () -> Unit) {
    var creating by remember { mutableStateOf(false) }
    if (creating) {
        NameDialog("新建组并移入", "例如 工作", close) { name -> g.addFolder(name).also { if (it) g.moveTo(group, name) } }
        return
    }
    val current = g.folderOf(group)
    AlertDialog(
        onDismissRequest = close,
        title = { Text("把 \"${g.directory.title(group)}\" 移到") },
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
internal fun NameDialog(title: String, hint: String, close: () -> Unit, ok: (String) -> Boolean) {
    var name by remember { mutableStateOf("") }
    var bad by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it; bad = false }, singleLine = true, isError = bad, placeholder = { Text(hint) }) },
        confirmButton = { TextButton({ if (ok(name)) close() else bad = true }) { Text("确定") } },
        dismissButton = { TextButton(close) { Text("取消") } },
    )
}

@Composable
private fun timeOfDay(ts: Long): String {
    val context = LocalContext.current
    return if (DateUtils.isToday(ts)) DateFormat.getTimeFormat(context).format(ts)
    else DateUtils.formatDateTime(context, ts, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH)
}
