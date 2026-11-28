package com.hengxin.aioa.ui.drive

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.ProgressLine
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.chartPalette
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.kit.pressable
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val DATE = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
private val CELL_SHAPE = RoundedCornerShape(14.dp)

internal fun timeText(ms: Long): String = if (ms > 0) DATE.format(Date(ms)) else ""

/** 一行的说明: 文件是 大小 · 时间, 文件夹只有时间; 搜索结果再加所在目录。 */
internal fun subOf(n: DriveNode): String = listOfNotNull(
    sizeText(n.size).takeIf { !n.dir },
    timeText(n.updatedAt).ifEmpty { null },
    DrivePaths.parent(n.path).takeIf { n.path.isNotEmpty() },
).joinToString(" · ")

/** 圆形图标按钮 (工具栏)。 */
@Composable
internal fun ToolIcon(icon: String, active: Boolean = false, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(Modifier.size(40.dp).clip(CircleShape).pressable(onClick), contentAlignment = Alignment.Center) { Icon(icon, if (active) c.accent else c.textSecondary, 20.dp) }
}

/** 面包屑: 点哪一级回到哪一级, 当前级用正文色。 */
@Composable
internal fun Crumbs(path: String, rootLabel: String, modifier: Modifier = Modifier, go: (String) -> Unit) {
    val c = Aioa.colors
    Row(modifier.horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
        DrivePaths.crumbs(path, rootLabel).forEachIndexed { i, (label, full) ->
            if (i > 0) Icon("chevron-right", c.textSecondary, 14.dp)
            val here = full == path
            Text(label, if (here) c.text else c.textSecondary, 14, Modifier.clip(RoundedCornerShape(6.dp)).pressable { go(full) }.padding(horizontal = 4.dp, vertical = 6.dp),
                weight = if (here) FontWeight.SemiBold else FontWeight.Normal)
        }
    }
}

/** 列表视图的一行: 点打开, 右边 "..." 出操作。 */
@Composable
internal fun NodeRow(n: DriveNode, divider: Boolean, onOpen: () -> Unit, onMore: () -> Unit) {
    val c = Aioa.colors
    HomeRow(n.name, subOf(n), divider = divider, lead = { Glyph(iconOf(n), if (n.dir) chartPalette().primary else c.text) }, end = {
        Box(Modifier.size(32.dp).clip(CircleShape).pointerTap(onMore), contentAlignment = Alignment.Center) { Icon("ellipsis", c.textSecondary, 18.dp) }
    }, onClick = onOpen)
}

/** 网格视图的一格: 大图标 + 名字 + 大小, 长按或点 "..." 出操作。 */
@Composable
internal fun NodeCell(n: DriveNode, onOpen: () -> Unit, onMore: () -> Unit) {
    val c = Aioa.colors
    Column(
        Modifier.clip(CELL_SHAPE).background(c.surface).border(1.dp, c.border.copy(alpha = 0.6f), CELL_SHAPE).pointerTap(onOpen).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(1.4f).clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt), contentAlignment = Alignment.Center) {
            Icon(iconOf(n), if (n.dir) chartPalette().primary else c.textSecondary, 30.dp)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(n.name, c.text, 13, weight = FontWeight.Medium)
                Text(if (n.dir) "文件夹" else sizeText(n.size), c.textSecondary, 11)
            }
            Box(Modifier.size(28.dp).clip(CircleShape).pointerTap(onMore), contentAlignment = Alignment.Center) { Icon("ellipsis", c.textSecondary, 16.dp) }
        }
    }
}

/** 正在传的与传完 / 失败的: 进度条, 失败可重试, 完成或失败可划掉。 */
@Composable
internal fun TransferList(list: List<Transfer>, onRetry: (Transfer) -> Unit, onDismiss: (Transfer) -> Unit) {
    val c = Aioa.colors
    val shape = RoundedCornerShape(16.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.surface).border(1.dp, c.border.copy(alpha = 0.6f), shape)) {
        list.forEachIndexed { i, t ->
            val sub = when {
                t.error != null -> t.error
                t.done -> if (t.up) "已上传到 ${t.dir}" else "已下载"
                else -> "${if (t.up) "上传" else "下载"} ${(t.progress * 100).toInt()}%"
            }
            HomeRow(t.name, sub, divider = i > 0, lead = { Glyph(if (t.up) "arrow-up" else "download", if (t.error != null) c.danger else c.text) }, end = {
                Row {
                    if (t.error != null && t.up) Box(Modifier.size(32.dp).clip(CircleShape).pointerTap { onRetry(t) }, contentAlignment = Alignment.Center) { Icon("refresh-cw", c.textSecondary, 16.dp) }
                    if (t.done || t.error != null) Box(Modifier.size(32.dp).clip(CircleShape).pointerTap { onDismiss(t) }, contentAlignment = Alignment.Center) { Icon("x", c.textSecondary, 16.dp) }
                }
            }) { if (!t.done && t.error == null) ProgressLine(t.progress) }
        }
    }
}

/** 页面里的一句提示 (只读目录, 空目录, 用量)。 */
@Composable
internal fun Note(icon: String, text: String, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    Row(modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, c.textSecondary, 15.dp)
        Text(text, c.textSecondary, 12, maxLines = 3)
    }
}
