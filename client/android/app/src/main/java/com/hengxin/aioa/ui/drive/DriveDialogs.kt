package com.hengxin.aioa.ui.drive

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.ActionSheet
import com.hengxin.aioa.ui.chat.SheetAction
import com.hengxin.aioa.ui.hxoa.InputDialog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private const val IMAGE_PX = 2048
private const val TEXT_SP = 13
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
    data class Picture(val n: DriveNode, val file: File) : DriveDialog
    data class Words(val n: DriveNode, val text: String) : DriveDialog
}

/** 点文件: 图片与小文本在 App 里看, 音视频交给系统播放器播直链, 其余下载后交给系统打开。 */
internal fun preview(context: Context, scope: CoroutineScope, n: DriveNode, show: (DriveDialog) -> Unit) {
    when (previewOf(n)) {
        Preview.IMAGE -> DriveTransfers.download(context, n) { show(DriveDialog.Picture(n, it)) }
        Preview.TEXT -> DriveTransfers.download(context, n) { f -> scope.launch { show(DriveDialog.Words(n, withContext(Dispatchers.IO) { f.readText() })) } }
        Preview.VIDEO, Preview.AUDIO -> scope.launch { if (!runCatching { stream(context, n) }.getOrDefault(false)) toast(context, "没有能播放它的应用") }
        Preview.SYSTEM -> openWithSystem(context, n)
    }
}

private suspend fun attempt(block: suspend () -> Unit): String? = try {
    block()
    null
} catch (e: DriveError) {
    e.message ?: "失败"
}

/** 长按或 "..." 的操作抽屉; 附件目录里的不给改名, 移动, 删除。 */
@Composable
internal fun NodeActions(n: DriveNode, readonly: Boolean, close: () -> Unit, open: (DriveNode) -> Unit, show: (DriveDialog) -> Unit) {
    val context = LocalContext.current
    val go = { f: () -> Unit -> { close(); f() } }
    val list = buildList {
        add(SheetAction(if (n.dir) "folder" else "eye", if (n.dir) "打开" else "预览", run = go { open(n) }))
        if (!n.dir) add(SheetAction("external-link", "用其他应用打开", run = go { openWithSystem(context, n) }))
        add(SheetAction("link", "分享链接", "有效期, 密码", run = go { show(DriveDialog.Share(n)) }))
        if (!n.dir) add(SheetAction("send", "发到群", run = go { show(DriveDialog.Send(n)) }))
        if (!readonly) {
            add(SheetAction("pencil", "改名", run = go { show(DriveDialog.Rename(n)) }))
            add(SheetAction("corner-down-right", "移动到", run = go { show(DriveDialog.Move(n)) }))
            add(SheetAction("trash-2", "删除", "移到回收站, 可以恢复", danger = true, run = go { show(DriveDialog.Delete(n)) }))
        }
    }
    ActionSheet(n.name, list, close)
}

/** 右上 "..." : 回收站, 我的分享, 刷新。 */
@Composable
internal fun PageMenu(close: () -> Unit, trash: () -> Unit, shares: () -> Unit, refresh: () -> Unit) {
    val go = { f: () -> Unit -> { close(); f() } }
    ActionSheet("网盘", listOf(
        SheetAction("trash-2", "回收站", run = go(trash)),
        SheetAction("link", "我的分享", run = go(shares)),
        SheetAction("refresh-cw", "刷新", run = go(refresh)),
    ), close)
}

@Composable
internal fun DriveDialogs(d: DriveDialog, api: DriveApi, chat: ChatModel, path: String, sort: DriveSort, setSort: (DriveSort) -> Unit, close: () -> Unit, changed: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val done = { close(); changed() }
    when (d) {
        DriveDialog.Sort -> ActionSheet("排序 (文件夹在前)", SortKey.entries.map { k ->
            SheetAction("chevrons-up-down", k.label, on = sort.key == k) { setSort(sort.copy(key = k)); close() }
        } + SheetAction("arrow-up", "倒序", on = sort.desc) { setSort(sort.copy(desc = !sort.desc)); close() }, close)
        DriveDialog.Mkdir -> InputDialog("新建文件夹", "", "在 $path 下", close, DrivePaths::validName) { name ->
            attempt { api.mkdir(DrivePaths.join(path, name)) }.also { if (it == null) done() }
        }
        is DriveDialog.Rename -> InputDialog("改名", d.n.name, "不能含 /", close, { DrivePaths.validName(it) && it != d.n.name }) { name ->
            attempt { api.rename(d.n.id, name) }.also { if (it == null) done() }
        }
        is DriveDialog.Delete -> AlertDialog(
            onDismissRequest = close,
            title = { androidx.compose.material3.Text("删除 ${d.n.name}?") },
            text = { androidx.compose.material3.Text("移到回收站, 可以在回收站恢复。") },
            confirmButton = {
                TextButton({ scope.launch { attempt { api.delete(d.n.id) }?.let { toast(context, it) }; done() } }) { androidx.compose.material3.Text("删除", color = Aioa.colors.danger) }
            },
            dismissButton = { TextButton(close) { androidx.compose.material3.Text("取消") } },
        )
        is DriveDialog.Move -> MovePicker(api, DrivePaths.parent(d.n.path.ifEmpty { DrivePaths.join(path, d.n.name) }), d.n, close) { to ->
            attempt { api.move(d.n.id, to) }.also { if (it == null) done() }
        }
        is DriveDialog.Share -> ShareDialog(api, d.n, close)
        is DriveDialog.Send -> ActionSheet("发到哪个群", chat.groups.rows().filter { com.hengxin.aioa.ui.chat.canPostTo(it.key, it.meta) }.sortedByDescending { it.order }.take(SEND_MAX).map { r ->
            SheetAction("message-circle", r.meta?.title?.takeIf { it.isNotBlank() } ?: r.key) {
                close()
                scope.launch { sendToGroup(context, chat, d.n, r.key) }
            }
        }, close)
        is DriveDialog.Picture -> PictureView(d.file, close)
        is DriveDialog.Words -> AlertDialog(
            onDismissRequest = close,
            title = { androidx.compose.material3.Text(d.n.name) },
            text = {
                Box(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState())) {
                    SelectionContainer { androidx.compose.material3.Text(d.text, color = Aioa.colors.text, fontSize = TEXT_SP.sp) }
                }
            },
            confirmButton = { TextButton(close) { androidx.compose.material3.Text("关闭") } },
        )
    }
}

/** 全屏看图: 按 2048 像素采样解码, 点一下关闭。 */
@Composable
private fun PictureView(file: File, close: () -> Unit) {
    val img by produceState<ImageBitmap?>(null, file) { value = withContext(Dispatchers.IO) { runCatching { decode(file) }.getOrNull() } }
    Dialog(close, DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black).pointerTap(close), contentAlignment = Alignment.Center) {
            img?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
        }
    }
}

private fun decode(file: File): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= IMAGE_PX || bounds.outHeight / (sample * 2) >= IMAGE_PX) sample *= 2
    return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}
