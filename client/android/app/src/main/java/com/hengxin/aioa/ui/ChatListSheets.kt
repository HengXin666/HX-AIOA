package com.hengxin.aioa.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.ui.chat.ActionSheet
import com.hengxin.aioa.ui.chat.ROLE_OWNER
import com.hengxin.aioa.ui.chat.SheetAction

// 列表上弹出的东西: 长按群的操作, 移到域, 打标签, 新建 / 加入 / 删除
internal sealed interface ListDialog {
    data class Move(val group: String) : ListDialog
    data object NewGroup : ListDialog
    data object NewFolder : ListDialog
    data class DropFolder(val name: String) : ListDialog
    data object Join : ListDialog
    data class Actions(val group: String) : ListDialog
    data class DomainActions(val name: String) : ListDialog
    data class Rename(val group: String) : ListDialog
    data class Delete(val group: String) : ListDialog
    data class Tags(val group: String?) : ListDialog
    data class NewTag(val group: String?) : ListDialog
}

@Composable
internal fun ListDialogs(g: ChatGroups, dialog: ListDialog?, set: (ListDialog?) -> Unit) {
    val close = { set(null) }
    when (val d = dialog) {
        is ListDialog.Move -> MoveSheet(g, d.group, set)
        is ListDialog.Actions -> GroupActions(g, d.group, set)
        is ListDialog.DomainActions -> ActionSheet("域 \"${d.name}\"", listOf(SheetAction("trash-2", "删除域", "群回到列表, 消息不受影响", danger = true) { set(ListDialog.DropFolder(d.name)) }), close)
        is ListDialog.Rename -> NameDialog("群名称", d.group, close, g.directory.title(d.group)) { g.directory.rename(d.group, it); true }
        is ListDialog.Delete -> DeleteGroupDialog(g, d.group, close)
        is ListDialog.Tags -> TagSheet(g, d.group, set)
        is ListDialog.NewTag -> NameDialog("新建标签", "例如 工作", { set(ListDialog.Tags(d.group)) }) { name ->
            val ok = g.tags.add(name)
            if (ok && d.group != null) g.tags.assign(d.group, g.tags.of(d.group).toSet() + name.trim())
            ok
        }
        ListDialog.NewGroup -> NameDialog("新建群", "例如 新闻", close) { name -> g.directory.createGroup(name).also { if (it) g.openGroup(name.trim()) } }
        ListDialog.NewFolder -> NameDialog("新建域", "例如 开发", close) { g.addFolder(it) }
        ListDialog.Join -> JoinDialog(g.pendingInvite.orEmpty(), { close(); g.pendingInvite = null }) { channel ->
            close()
            g.pendingInvite = null
            g.directory.refreshChats()
            g.openGroup(channel)
        }
        is ListDialog.DropFolder -> AlertDialog(
            onDismissRequest = close,
            title = { Text("删除域 \"${d.name}\"?") },
            text = { Text("域里的群会回到列表, 消息不受影响。") },
            confirmButton = { TextButton({ g.removeFolder(d.name); close() }) { Text("删除") } },
            dismissButton = { TextButton(close) { Text("取消") } },
        )
        null -> Unit
    }
}

/** 长按群: 置顶, 免打扰, 标签, 移到域, 改名, 删除 (只有群主能删, 备忘不能删)。 */
@Composable
private fun GroupActions(g: ChatGroups, group: String, set: (ListDialog?) -> Unit) {
    val dir = g.directory
    val meta = dir.metas[group]
    val memo = group == MessageDb.MEMO_GROUP
    val owner = meta?.role == null || meta.role == ROLE_OWNER
    val tags = g.tags.of(group)
    val folder = g.folderOf(group)
    val list = buildList {
        add(SheetAction("pin", if (meta?.pinned == true) "取消置顶" else "置顶") { dir.setPinned(group, meta?.pinned != true); set(null) })
        add(SheetAction("bell-off", if (meta?.muted == true) "取消免打扰" else "免打扰", "免打扰时 @ 到你仍会提醒") { dir.setMuted(group, meta?.muted != true); set(null) })
        add(SheetAction("tag", "标签", tags.joinToString(", ").ifEmpty { "可以打多个, 列表顶部按标签筛选" }) { set(ListDialog.Tags(group)) })
        add(SheetAction("layers", "移到域", folder?.let { "现在在 $it" } ?: "一个群只在一个域里") { set(ListDialog.Move(group)) })
        if ((meta?.canTune ?: true) && !memo && meta?.isDm != true) add(SheetAction("pencil", "重命名") { set(ListDialog.Rename(group)) })
        if (owner && !memo) add(SheetAction("trash-2", "删除群", danger = true) { set(ListDialog.Delete(group)) })
    }
    ActionSheet(dir.title(group), list, { set(null) })
}

/** 移到域: 一个群只在一个域里。 */
@Composable
private fun MoveSheet(g: ChatGroups, group: String, set: (ListDialog?) -> Unit) {
    var creating by remember { mutableStateOf(false) }
    if (creating) {
        NameDialog("新建域并移入", "例如 开发", { set(null) }) { name -> g.addFolder(name).also { if (it) g.moveTo(group, name) } }
        return
    }
    val current = g.folderOf(group)
    val list = g.folders.map { f -> SheetAction("layers", f.name, "${f.groups.size} 个群", on = f.name == current) { g.moveTo(group, f.name); set(null) } } +
        listOfNotNull(
            current?.let { SheetAction("x", "移出域") { g.moveTo(group, null); set(null) } },
            SheetAction("plus", "新建域") { creating = true },
        )
    ActionSheet("把 \"${g.directory.title(group)}\" 移到", list, { set(null) })
}

/** 打标签 (group 非空) 或管理标签 (group 为空, 点一项删除)。 */
@Composable
private fun TagSheet(g: ChatGroups, group: String?, set: (ListDialog?) -> Unit) {
    val all = g.tags.tags
    val mine = group?.let { g.tags.of(it).toSet() }.orEmpty()
    val list = all.keys.map { t ->
        if (group != null) SheetAction("tag", t, "${all[t]?.size ?: 0} 个会话", on = t in mine) {
            g.tags.assign(group, if (t in mine) mine - t else mine + t)
        } else SheetAction("trash-2", "删除 \"$t\"", "${all[t]?.size ?: 0} 个会话, 会话本身不受影响", danger = true) { g.tags.drop(t) }
    } + SheetAction("plus", "新建标签") { set(ListDialog.NewTag(group)) }
    ActionSheet(group?.let { "给 \"${g.directory.title(it)}\" 打标签" } ?: "管理标签", list, { set(null) })
}
