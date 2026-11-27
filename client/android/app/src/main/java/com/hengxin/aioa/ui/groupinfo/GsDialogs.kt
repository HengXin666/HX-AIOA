package com.hengxin.aioa.ui.groupinfo

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.ui.ChatGroups
import com.hengxin.aioa.ui.chat.ChatMeta
import com.hengxin.aioa.ui.chat.DIGEST_DAILY
import com.hengxin.aioa.ui.chat.DIGEST_WEEKLY
import com.hengxin.aioa.ui.chat.VIEW_CHAT
import com.hengxin.aioa.ui.chat.VIEW_FEED
import org.json.JSONObject

// 群公告上限, 与服务端 ChatMeta.notice 一致 (#133)
const val NOTICE_MAX = 500
private const val NO_FOLDER = "#none"
private const val CANCEL = "取消"

sealed interface GsDialog {
    data object Rename : GsDialog
    data class Notice(val edit: Boolean) : GsDialog
    data object Folder : GsDialog
    data object Digest : GsDialog
    data object View : GsDialog
    data object Tags : GsDialog
    data object Clear : GsDialog
    data object Delete : GsDialog
    data object Leave : GsDialog
}

/** 群聊设置的全部对话框; onClear / onLeave 由页面执行 (要改页面上的忙碌状态或退出页面)。 */
@Composable
internal fun GsDialogs(g: ChatGroups, group: String, meta: ChatMeta?, dialog: GsDialog?, close: () -> Unit, onClear: () -> Unit, onLeave: () -> Unit) {
    val dir = g.directory
    when (dialog) {
        GsDialog.Rename -> RenameDialog(if (meta?.isDm == true) "备注名" else "群名称", meta?.title ?: group, close) { dir.rename(group, it) }
        is GsDialog.Notice -> NoticeDialog(meta?.notice.orEmpty(), dialog.edit, close) { text ->
            val v = text.trim().take(NOTICE_MAX).ifEmpty { null }
            dir.patch(group, JSONObject().put("notice", v ?: JSONObject.NULL)) { it.copy(notice = v) }
        }
        GsDialog.Folder -> PickDialog("所属域", listOf(NO_FOLDER to "不放进域") + g.folders.map { it.name to it.name }, g.folderOf(group) ?: NO_FOLDER, close) {
            g.moveTo(group, it.takeIf { k -> k != NO_FOLDER })
        }
        GsDialog.Digest -> PickDialog("群类型", listOf("" to "普通", DIGEST_DAILY to "日报", DIGEST_WEEKLY to "周报"), meta?.digest.orEmpty(), close,
            hint = "标成日报 / 周报后, 其它群的消息长按可以 \"收录\" 到这里, 精选 Agent 也可以直接往这里发报告。") {
            dir.setDigest(group, it.ifEmpty { null })
        }
        GsDialog.View -> PickDialog("展示方式", listOf(VIEW_CHAT to "聊天", VIEW_FEED to "信息流"), if (meta?.isFeed == true) VIEW_FEED else VIEW_CHAT, close,
            hint = "信息流: 推送卡片按条目平铺, 有今天 / 全部 / 收藏, 适合福利, 资讯类群。") {
            dir.setFeed(group, it == VIEW_FEED)
        }
        GsDialog.Tags -> com.hengxin.aioa.ui.feed.FeedTagsDialog(meta?.tags.orEmpty(), close) { dir.setFeedTags(group, it) }
        GsDialog.Delete -> DeleteDialog(g, group, close)
        GsDialog.Clear -> Confirm("清空聊天记录?", "服务端和所有设备上这个群的消息都会删掉, 收藏不受影响, 群资料与 Agent 保留。", "清空", close, onClear)
        GsDialog.Leave -> Confirm("退出这个群?", "退出后收不到这个群的消息, 需要重新被邀请才能回来。", "退出", close, onLeave)
        null -> Unit
    }
}

@Composable
private fun Confirm(title: String, text: String, ok: String, close: () -> Unit, run: () -> Unit) {
    AlertDialog(
        onDismissRequest = close,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton({ close(); run() }) { Text(ok, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(close) { Text(CANCEL) } },
    )
}

/** 单选列表: 当前项打勾, 点一项即保存并关闭。 */
@Composable
internal fun PickDialog(title: String, options: List<Pair<String, String>>, selected: String, close: () -> Unit, hint: String = "", pick: (String) -> Unit) {
    val c = Aioa.colors
    AlertDialog(
        onDismissRequest = close,
        title = { Text(title) },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                if (hint.isNotEmpty()) Text(hint, Modifier.padding(bottom = 8.dp), color = c.textSecondary, style = MaterialTheme.typography.bodySmall)
                options.forEachIndexed { i, (k, label) ->
                    HomeRow(label, divider = i > 0, onClick = { close(); pick(k) }, end = { if (k == selected) Icon("check", c.accent, 16.dp) })
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(close) { Text(CANCEL) } },
    )
}

/** 群公告: 群主 / 管理员可改 (#133), 其他人只读。 */
@Composable
private fun NoticeDialog(initial: String, edit: Boolean, close: () -> Unit, save: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text("群公告") },
        text = {
            if (edit) {
                OutlinedTextField(
                    text, { text = it.take(NOTICE_MAX) }, Modifier.fillMaxWidth().heightIn(min = 120.dp),
                    placeholder = { Text("写给所有成员, 进群时在顶部显示") },
                    supportingText = { Text("${text.length} / $NOTICE_MAX") },
                )
            } else Text(initial.ifEmpty { "还没有群公告" }, Modifier.verticalScroll(rememberScrollState()))
        },
        confirmButton = { if (edit) TextButton({ save(text); close() }) { Text("保存") } },
        dismissButton = { TextButton(close) { Text(if (edit) CANCEL else "关闭") } },
    )
}

@Composable
private fun RenameDialog(title: String, initial: String, close: () -> Unit, save: (String) -> Unit) {
    var name by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it }, singleLine = true) },
        confirmButton = { TextButton({ save(name.trim()); close() }, enabled = name.isNotBlank()) { Text("确定") } },
        dismissButton = { TextButton(close) { Text(CANCEL) } },
    )
}

@Composable
private fun DeleteDialog(g: ChatGroups, group: String, close: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) close() },
        title = { Text("删除群 \"${g.directory.title(group)}\"?") },
        text = { Text("聊天记录, 文件, 接入的 Agent (密钥作废), 插件与待办, 群成员都会删掉, 所有设备同步, 不能恢复。之后再有推送进这个群, 它会重新出现。") },
        confirmButton = {
            TextButton({ busy = true; g.deleteGroup(group) { close() } }, enabled = !busy) {
                Text(if (busy) "正在删除..." else "删除", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = { TextButton(close, enabled = !busy) { Text(CANCEL) } },
    )
}
