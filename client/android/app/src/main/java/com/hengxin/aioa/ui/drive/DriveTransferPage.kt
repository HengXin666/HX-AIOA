package com.hengxin.aioa.ui.drive

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.ProgressLine
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.ui.hxoa.FullPage

/** 传输页 (#158): 上传与保存到手机放在一起; 下载可暂停, 继续, 取消, 完成后打开或在文件夹中显示。 */
@Composable
internal fun TransfersPage(back: () -> Unit) {
    val context = LocalContext.current
    val c = Aioa.colors
    val ups = DriveTransfers.items.toList().asReversed()
    val dls = DriveDownloads.tasks.toList().asReversed()
    FullPage(back, "传输", "上传到网盘, 保存到手机 (下载/AIOA)") {
        if (ups.isEmpty() && dls.isEmpty()) Note("download", "没有传输任务", Modifier.padding(12.dp))
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp)) {
            if (dls.isNotEmpty()) item { Note("download", "保存到手机") }
            itemsIndexed(dls, key = { _, t -> "dl:${t.id}" }) { i, t ->
                val sub = when (t.state) {
                    DlState.RUNNING -> "${sizeText(t.done)} / ${sizeText(t.size)} · ${speedText(t.speed)} · ${etaText(etaSec(t.size - t.done, t.speed))}"
                    DlState.PAUSED -> "已暂停 · ${sizeText(t.done)} / ${sizeText(t.size)}"
                    DlState.FAILED -> t.error ?: "保存失败"
                    DlState.DONE -> "已保存 · ${sizeText(t.size)}"
                }
                HomeRow(t.name, sub, divider = i > 0, lead = { Glyph("download", if (t.state == DlState.FAILED) c.danger else c.text) }, end = {
                    Row {
                        when (t.state) {
                            DlState.RUNNING -> Act("circle-pause") { DriveDownloads.pause(context, t) }
                            DlState.PAUSED, DlState.FAILED -> Act("play") { DriveDownloads.resume(context, t) }
                            DlState.DONE -> {
                                Act("external-link") { t.uri?.let { u -> if (!DriveDownloads.open(context, android.net.Uri.parse(u), t.mime)) toast(context, "没有能打开它的应用") } }
                                Act("folder") { DriveDownloads.showFolder(context) }
                            }
                        }
                        Act("x") { DriveDownloads.cancel(context, t) }
                    }
                }) { if (t.state == DlState.RUNNING || t.state == DlState.PAUSED) ProgressLine(t.progress) }
            }
            if (ups.isNotEmpty()) item { Note("arrow-up", "上传到网盘") }
            itemsIndexed(ups, key = { _, t -> "up:${t.key}" }) { i, t ->
                val sub = when {
                    t.error != null -> t.error
                    t.done -> "已上传到 ${t.dir}"
                    else -> "${(t.progress * 100).toInt()}% · ${speedText(t.speed)} · ${etaText(etaSec(((1 - t.progress) * t.size).toLong(), t.speed))}"
                }
                HomeRow(t.name, sub, divider = i > 0, lead = { Glyph("arrow-up", if (t.error != null) c.danger else c.text) }, end = {
                    Row {
                        if (t.error != null) Act("refresh-cw") { DriveTransfers.retry(context, t) }
                        if (t.done || t.error != null) Act("x") { DriveTransfers.dismiss(t) }
                    }
                }) { if (!t.done && t.error == null) ProgressLine(t.progress) }
            }
        }
    }
}

@Composable
private fun Act(icon: String, onClick: () -> Unit) {
    Box(Modifier.size(36.dp).clip(CircleShape).pointerTap(onClick), contentAlignment = Alignment.Center) { Icon(icon, Aioa.colors.textSecondary, 18.dp) }
}
