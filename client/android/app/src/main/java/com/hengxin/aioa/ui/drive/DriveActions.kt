package com.hengxin.aioa.ui.drive

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.core.content.FileProvider
import com.hengxin.aioa.proto.FileRef
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.FileTransfer
import kotlinx.coroutines.launch
import java.io.File

private const val SAVE_DIR = "/聊天文件"
private const val NEED_UPLOAD = "need_upload"
private const val FILE_TEXT_PREFIX = "[文件] "
private const val MEMO = "备忘"

internal fun toast(context: Context, text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()

/** 本机文件给系统与上传用的 content:// 地址 (FileProvider 的 att / drive 目录)。 */
internal fun shareUri(context: Context, file: File): Uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)

/** 视频与音频交给系统播放器直接播直链 (支持拖动), 不先下载。 */
internal suspend fun stream(context: Context, n: DriveNode): Boolean {
    val url = DriveTransfers.link(context, n)
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(url), n.mime.ifEmpty { "video/*" }).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return runCatching { context.startActivity(Intent.createChooser(view, "播放").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
}

/** 下载后用系统里能打开它的应用打开。 */
internal fun openWithSystem(context: Context, n: DriveNode) {
    DriveTransfers.download(context, n) { f ->
        if (!FileTransfer.open(context, f, n.mime.ifEmpty { "application/octet-stream" })) toast(context, "没有能打开它的应用")
    }
}

/**
 * 聊天文件存到网盘 (#154): 文件在 Drive 上时服务端复制 (0 字节); 否则用本机副本 (没有就先下载) 上传到 /聊天文件。
 */
suspend fun saveChatFile(context: Context, f: FileRef) {
    val app = context.applicationContext
    try {
        val dir = DriveApi(app).save(f.id)
        toast(app, "已存到网盘 $dir")
        return
    } catch (e: DriveError) {
        if (e.apiCode != NEED_UPLOAD) return toast(app, e.message ?: "存到网盘失败")
    }
    val local = FileTransfer.cached(app, f) ?: FileTransfer.download(app, f) {}.getOrElse { return toast(app, it.message ?: "下载失败") }
    DriveTransfers.upload(app, listOf(shareUri(app, local)), SAVE_DIR)
    toast(app, "开始上传到网盘 $SAVE_DIR")
}

/**
 * 网盘文件发到群 (#154): 服务端把节点复制进附件目录并登记 (0 字节), 再发一条带附件的消息;
 * 复制不了时下载到本机再走普通的附件上传。groupKey 为会话 key, 备忘的 channel 为空。
 */
suspend fun sendToGroup(context: Context, chat: ChatModel, n: DriveNode, groupKey: String) {
    val app = context.applicationContext
    val channel = groupKey.takeIf { it != MEMO }
    val text = FILE_TEXT_PREFIX + n.name
    val id = try {
        DriveApi(app).attach(n.id, channel)
    } catch (e: DriveError) {
        if (e.apiCode != NEED_UPLOAD) return toast(app, e.message ?: "发送失败")
        null
    }
    if (id != null) {
        toast(app, if (chat.sendFileRef(channel, text, id)) "已发送" else "没连上服务端, 稍后再试")
        return
    }
    toast(app, "正在下载后发送")
    DriveTransfers.download(app, n) { f ->
        DriveTransfers.ui.launch {
            FileTransfer.upload(app, shareUri(app, f), channel) {}.onSuccess { ref ->
                toast(app, if (chat.sendFileRef(channel, text, ref.id)) "已发送" else "没连上服务端, 稍后再试")
            }.onFailure { toast(app, it.message ?: "上传失败") }
        }
    }
}
