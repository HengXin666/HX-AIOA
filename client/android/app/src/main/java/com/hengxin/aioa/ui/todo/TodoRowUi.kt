package com.hengxin.aioa.ui.todo

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.TodoRow
import com.hengxin.aioa.kit.pressable
import kotlinx.coroutines.delay

/** 倒计时用的 "现在": 看板等每分钟换一次, 只让读它的行重组, 列表不重建 (滚动位置不丢)。 */
val LocalNow = compositionLocalOf { System.currentTimeMillis() }

/** 每分钟走一次的现在, 给 LocalNow 用。 */
@Composable
fun rememberNow(): Long {
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(MINUTE_MS - System.currentTimeMillis() % MINUTE_MS)
            value = System.currentTimeMillis()
        }
    }
    return now
}

// 看板, 总览精简视图, 重点待办共用的一行待办 (勾选框或折叠箭头, 标题, 截止倒计时等元信息)
private const val INDENT = 22
private val PILL = RoundedCornerShape(50)
private const val CHIP_ALPHA = 0.12f
private const val PRIO_URGENT = 1

@Composable
internal fun NodeRows(n: TodoNode, depth: Int, closed: Set<String>, toggle: (String) -> Unit, open: (TodoRow) -> Unit, showRepo: Boolean = false, showArea: Boolean = false, tick: (TodoRow) -> Unit) {
    val c = Aioa.colors
    val r = n.row
    val key = "n:${r.channel}:${r.id}"
    val parent = n.kids.isNotEmpty()
    val shut = key in closed
    Box(Modifier.fillMaxWidth().padding(start = (12 + depth * INDENT).dp).height(0.5.dp).background(c.border))
    Row(Modifier.fillMaxWidth().pressable { open(r) }.padding(start = (12 + depth * INDENT).dp, end = 12.dp, top = 9.dp, bottom = 9.dp), verticalAlignment = Alignment.Top) {
        if (parent) {
            Box(Modifier.size(20.dp).clip(PILL).clickable { toggle(key) }, contentAlignment = Alignment.Center) { Icon(if (shut) "chevron-right" else "chevron-down", c.textSecondary, 16.dp) }
        } else {
            Box(Modifier.size(20.dp).clip(RoundedCornerShape(6.dp)).clickable { tick(r) }, contentAlignment = Alignment.Center) {
                Icon(if (r.finished) "square-check" else "square", if (r.finished) c.success else c.textSecondary, 19.dp)
            }
        }
        Column(Modifier.padding(start = 10.dp).weight(1f)) {
            Text(
                r.title,
                color = if (r.finished) c.textSecondary else c.text,
                fontSize = 14.sp,
                textDecoration = if (r.finished) TextDecoration.LineThrough else null,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            MetaLine(r, showRepo, showArea)
        }
        if (parent) Text("${n.done}/${n.total}", Modifier.padding(start = 6.dp).clip(PILL).background(c.surfaceAlt).padding(horizontal = 6.dp, vertical = 1.dp), color = c.textSecondary, fontSize = 11.sp)
    }
    if (parent && !shut) n.kids.forEach { NodeRows(it, depth + 1, closed, toggle, open, showRepo, showArea, tick) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MetaLine(r: TodoRow, showRepo: Boolean, showArea: Boolean) {
    val c = Aioa.colors
    // 一行放不下时换行, 截止和星标这类要紧的放前面
    FlowRow(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        if (r.star && !r.finished) Icon("star", c.warning, 12.dp)
        if (!r.finished) r.due?.let { due ->
            val (text, hot) = countdown(due, LocalNow.current)
            Pill(text, if (hot) c.danger else c.accent, if (r.alarm) "alarm-clock" else "clock")
        }
        everyText(r.everyUnit, r.everyN)?.let { Pill(it, c.textSecondary, "repeat") }
        if (showArea) Text(r.areaKey, color = c.textSecondary, fontSize = 11.sp)
        // 总览的待办组件不按仓库分组, 每条标出仓库
        if (showRepo) r.repo?.let { repo ->
            Box(Modifier.size(7.dp).clip(RoundedCornerShape(2.dp)).background(repoColor(repo)))
            Text(repoName(repo), color = c.textSecondary, fontSize = 11.sp)
        }
        if (!r.finished) Text("P${r.prio}", color = if (r.prio == PRIO_URGENT) c.danger else c.textSecondary, fontSize = 11.sp)
        stateColor(r.state)?.let { Pill(stateLabel(r.state), it) }
        r.issue?.let { n -> Pill("#$n", if (r.ghOpen == false) DONE_PURPLE else c.success, if (r.ghOpen == false) "circle-check" else "circle-dot") }
        if (r.ghComments > 0 && r.ghOpen != false) Text("${r.ghComments} 评论", color = c.textSecondary, fontSize = 11.sp)
        val time = r.doneAt?.takeIf { r.finished }?.let { "${shortDay(it)} ${clock(it)} 完成" } ?: r.created.takeIf { it > 0 && r.due == null }?.let { "${clock(it)} 创建" }
        time?.let { Text(it, color = c.textSecondary, fontSize = 11.sp) }
    }
}

private val DONE_PURPLE = Color(0xFF8250DF)

@Composable
internal fun stateColor(s: String): Color? = when (s) {
    TodoRow.STATE_DOING -> Aioa.colors.accent
    TodoRow.STATE_HOLD -> Aioa.colors.warning
    else -> null
}

@Composable
internal fun Pill(text: String, color: Color, icon: String? = null) {
    Row(Modifier.clip(PILL).background(color.copy(alpha = CHIP_ALPHA)).padding(horizontal = 6.dp, vertical = 1.dp), verticalAlignment = Alignment.CenterVertically) {
        icon?.let { Icon(it, color, 11.dp); Spacer(Modifier.width(3.dp)) }
        Text(text, color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}


@Composable
internal fun Text(
    text: String,
    modifier: Modifier = Modifier,
    color: Color,
    fontSize: TextUnit,
    fontWeight: FontWeight? = null,
    textDecoration: TextDecoration? = null,
    maxLines: Int = 1,
    overflow: TextOverflow = TextOverflow.Ellipsis,
) = androidx.compose.material3.Text(text, modifier, color = color, fontSize = fontSize, fontWeight = fontWeight, textDecoration = textDecoration, maxLines = maxLines, overflow = overflow)
