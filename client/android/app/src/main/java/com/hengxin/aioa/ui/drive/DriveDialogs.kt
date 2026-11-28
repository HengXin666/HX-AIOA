package com.hengxin.aioa.ui.drive

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.ActionSheet
import com.hengxin.aioa.ui.chat.SheetAction
import com.hengxin.aioa.ui.hxoa.InputDialog
import kotlinx.coroutines.launch

private const val SEND_MAX = 30

/** 网盘页的弹窗。 */
sealed interface DriveDialog {
    data object Sort : DriveDialog
    data object Mkdir : DriveDialog
    data class Rename(val n: DriveNode) : DriveDialog
    data class Move(val n: DriveNode) : DriveDialog
    data class Share(val n: DriveNode) : DriveDialog
    data class Send(val n: DriveNode) : DriveDialog
    data class Delete(val n: DriveNode) : DriveDialog
    data object About : DriveDialog
}

/** 长按或 "..." 的操作抽屉。 */
@Composable
internal fun NodeActions(n: DriveNode, close: () -> Unit, open: (DriveNode) -> Unit, show: (DriveDialog) -> Unit) {
    val context = LocalContext.current
    val go = { f: () -> Unit -> { close(); f() } }
    val list = buildList {
        add(SheetAction(if (n.dir) "folder" else "eye", if (n.dir) "打开" else "预览", run = go { open(n) }))
        if (!n.dir) {
            val saved = DriveDownloads.saved(context, n) != null
            add(SheetAction(if (saved) "external-link" else "download", if (saved) "打开已保存的" else "保存到手机", "存到 下载/AIOA", run = go { DriveDownloads.save(context, n) }))
            add(SheetAction("external-link", "用其他应用打开", run = go { openWithSystem(context, n) }))
        }
        add(SheetAction("link", "分享链接", "有效期, 密码", run = go { show(DriveDialog.Share(n)) }))
        if (!n.dir) add(SheetAction("send", "发到群", run = go { show(DriveDialog.Send(n)) }))
        add(SheetAction("pencil", "改名", run = go { show(DriveDialog.Rename(n)) }))
        add(SheetAction("corner-down-right", "移动到", run = go { show(DriveDialog.Move(n)) }))
        add(SheetAction("trash-2", "删除", "移到回收站, 可以恢复", danger = true, run = go { show(DriveDialog.Delete(n)) }))
    }
    ActionSheet(n.name, list, close)
}

/** 右上 "..." : 传输, 回收站, 我的分享, 刷新, 关于网盘。 */
@Composable
internal fun PageMenu(close: () -> Unit, transfers: () -> Unit, trash: () -> Unit, shares: () -> Unit, refresh: () -> Unit, about: () -> Unit) {
    val go = { f: () -> Unit -> { close(); f() } }
    ActionSheet("网盘", listOf(
        SheetAction("download", "传输", "上传与保存到手机", run = go(transfers)),
        SheetAction("trash-2", "回收站", run = go(trash)),
        SheetAction("link", "我的分享", run = go(shares)),
        SheetAction("refresh-cw", "刷新", run = go(refresh)),
        SheetAction("hard-drive", "关于网盘", run = go(about)),
    ), close)
}

@Composable
internal fun DriveDialogs(d: DriveDialog, api: DriveApi, chat: ChatModel, path: String, sort: DriveSort, setSort: (DriveSort) -> Unit, close: () -> Unit, edit: (DriveEdit) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // 改动先上列表再发请求 (#159), 弹窗立刻关掉; 失败由 edit 回滚并提示
    val act = { e: DriveEdit -> close(); edit(e); null }
    when (d) {
        DriveDialog.Sort -> ActionSheet("排序 (文件夹在前)", SortKey.entries.map { k ->
            SheetAction("chevrons-up-down", k.label, on = sort.key == k) { setSort(sort.copy(key = k)); close() }
        } + SheetAction("arrow-up", "倒序", on = sort.desc) { setSort(sort.copy(desc = !sort.desc)); close() }, close)
        DriveDialog.Mkdir -> InputDialog("新建文件夹", "", "在 $path 下", close, DrivePaths::validName) { name ->
            act(DriveEdit("新建文件夹", { DriveEdits.add(it, name) }) { api.mkdir(DrivePaths.join(path, name)) })
        }
        is DriveDialog.Rename -> InputDialog("改名", d.n.name, "不能含 /", close, { DrivePaths.validName(it) && it != d.n.name }) { name ->
            act(DriveEdit("改名", { DriveEdits.rename(it, d.n.id, name) }) { api.rename(d.n.id, name) })
        }
        is DriveDialog.Delete -> AlertDialog(
            onDismissRequest = close,
            title = { androidx.compose.material3.Text("删除 ${d.n.name}?") },
            text = { androidx.compose.material3.Text("移到回收站, 可以在回收站恢复。") },
            confirmButton = {
                TextButton({ act(DriveEdit("删除", { DriveEdits.remove(it, d.n.id) }) { api.delete(d.n.id) }) }) { androidx.compose.material3.Text("删除", color = Aioa.colors.danger) }
            },
            dismissButton = { TextButton(close) { androidx.compose.material3.Text("取消") } },
        )
        is DriveDialog.Move -> MovePicker(api, DrivePaths.parent(d.n.path.ifEmpty { DrivePaths.join(path, d.n.name) }), d.n, close) { to ->
            act(DriveEdit("移动", { DriveEdits.move(it, d.n.id, path, to) }) { api.move(d.n.id, to) })
        }
        is DriveDialog.Share -> ShareDialog(api, d.n, close)
        is DriveDialog.Send -> ActionSheet("发到哪个群", chat.groups.rows().filter { com.hengxin.aioa.ui.chat.canPostTo(it.key, it.meta) }.sortedByDescending { it.order }.take(SEND_MAX).map { r ->
            SheetAction("message-circle", r.meta?.title?.takeIf { it.isNotBlank() } ?: r.key) {
                close()
                scope.launch { sendToGroup(context, chat, d.n, r.key) }
            }
        }, close)
        DriveDialog.About -> AlertDialog(
            onDismissRequest = close,
            title = { androidx.compose.material3.Text("关于网盘") },
            text = { androidx.compose.material3.Text(DRIVE_ABOUT) },
            confirmButton = { TextButton(close) { androidx.compose.material3.Text("知道了") } },
        )
    }
}
