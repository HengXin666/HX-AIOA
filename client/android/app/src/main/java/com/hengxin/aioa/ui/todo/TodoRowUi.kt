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
import com.hengxin.aioa.kit.TreePath
import com.hengxin.aioa.kit.treeGuides
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
// 选中态与标签的底色透明度, 待办各页共用
internal const val CHIP_ALPHA = 0.12f
private const val PRIO_URGENT = 1
private const val GUIDE_ALPHA = 0.5f
private const val ROW_PAD = 8
private const val MARK = 18
private const val BAR_W = 28

@Composable
internal fun NodeRows(n: TodoNode, depth: Int, closed: Set<String>, toggle: (String) -> Unit, open: (TodoRow) -> Unit, showRepo: Boolean = false, showArea: Boolean = false, lasts: TreePath = emptyList(), tick: (TodoRow) -> Unit) {
    val c = Aioa.colors
    val r = n.row
    val key = "n:${r.channel}:${r.id}"
    val parent = n.kids.isNotEmpty()
    val shut = key in closed
    // 树形列表, 一行一条 (#121): 左边层级连线, 勾选框 / 折叠箭头, issue 图标, 标题, 右边压成小标注
    Column(Modifier.fillMaxWidth().treeGuides(lasts, parent && !shut, c.textSecondary.copy(alpha = GUIDE_ALPHA), indent = INDENT.dp, marker = MARK.dp, top = (ROW_PAD + 0.5f).dp)) {
        Box(Modifier.fillMaxWidth().padding(start = (12 + depth * INDENT).dp).height(0.5.dp).background(c.border))
        Row(
            Modifier.fillMaxWidth().pressable { open(r) }.padding(start = (12 + depth * INDENT).dp, end = 12.dp, top = ROW_PAD.dp, bottom = ROW_PAD.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (parent) {
                Box(Modifier.size(MARK.dp).clip(PILL).clickable { toggle(key) }, contentAlignment = Alignment.Center) { Icon(if (shut) "chevron-right" else "chevron-down", c.textSecondary, 15.dp) }
            } else {
                Box(Modifier.size(MARK.dp).clip(RoundedCornerShape(5.dp)).clickable { tick(r) }, contentAlignment = Alignment.Center) {
                    Icon(if (r.finished) "square-check" else "square", if (r.finished) c.success else c.textSecondary, 17.dp)
                }
            }
            r.issue?.let { Icon(if (r.ghOpen == false) "circle-check" else "circle-dot", if (r.ghOpen == false) DONE_PURPLE else c.success, 14.dp) }
            Text(
                r.title,
                Modifier.weight(1f),
                color = if (r.finished) c.textSecondary else c.text,
                fontSize = 14.sp,
                fontWeight = if (parent) FontWeight.SemiBold else null,
                textDecoration = if (r.finished) TextDecoration.LineThrough else null,
            )
            Marks(n, showRepo, showArea)
        }
    }
    if (parent && !shut) n.kids.forEachIndexed { i, k -> NodeRows(k, depth + 1, closed, toggle, open, showRepo, showArea, lasts + (i == n.kids.lastIndex), tick) }
}

/** 一行右边的小标注: 按要紧程度排, 放不下的往后省略 (标题先让位)。 */
@Composable
private fun Marks(n: TodoNode, showRepo: Boolean, showArea: Boolean) {
    val c = Aioa.colors
    val r = n.row
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!r.finished && r.prio == PRIO_URGENT) Icon("flame", c.danger, 12.dp)
        if (r.star && !r.finished) Icon("star", c.warning, 12.dp)
        stateColor(r.state)?.let { Box(Modifier.size(6.dp).clip(RoundedCornerShape(2.dp)).background(it)) }
        if (!r.finished) r.due?.let { due ->
            val (text, hot) = countdown(due, LocalNow.current)
            Pill(text.removePrefix("还剩 "), if (hot) c.danger else c.accent, if (r.alarm) "alarm-clock" else "clock")
        }
        if (r.everyUnit != null) Icon("repeat", c.textSecondary, 12.dp)
        if (showArea) Text(r.areaKey, color = c.textSecondary, fontSize = 11.sp)
        if (showRepo) r.repo?.let { repo ->
            Icon("github", repoColor(repo), 12.dp)
            Text(repoName(repo), color = c.textSecondary, fontSize = 11.sp)
        }
        r.issue?.let { Text("#$it", color = c.textSecondary, fontSize = 11.sp) }
        if (n.kids.isNotEmpty()) {
            Box(Modifier.width(BAR_W.dp).height(4.dp).clip(PILL).background(c.surfaceAlt)) {
                Box(Modifier.fillMaxWidth(if (n.total > 0) n.done.toFloat() / n.total else 0f).height(4.dp).clip(PILL).background(if (n.done == n.total) c.success else c.accent))
            }
            Text("${n.done}/${n.total}", color = c.textSecondary, fontSize = 11.sp)
        }
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
