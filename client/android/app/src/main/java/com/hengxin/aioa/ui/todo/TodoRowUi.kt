package com.hengxin.aioa.ui.todo

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.TodoFold
import com.hengxin.aioa.kit.TodoLine
import com.hengxin.aioa.kit.TodoRow
import com.hengxin.aioa.kit.TreePath
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

// 看板, 总览精简视图, 重点待办共用的一行; 外观在组件库 TodoLine, 群里消息下挂的待办也用它
// 选中态与标签的底色透明度, 待办各页共用
internal const val CHIP_ALPHA = 0.12f

@Composable
internal fun NodeRows(n: TodoNode, depth: Int, closed: Set<String>, toggle: (String) -> Unit, open: (TodoRow) -> Unit, showRepo: Boolean = false, showArea: Boolean = false, lasts: TreePath = emptyList(), tick: (TodoRow) -> Unit) {
    val r = n.row
    val key = "n:${r.channel}:${r.id}"
    val shut = key in closed
    // 子项都没显示 (藏了已完成, 在别的列) 也画进度 (#152), 只是不能折叠
    val fold = if (n.total > 0) TodoFold(n.done, n.total, shut, canFold = n.kids.isNotEmpty()) { toggle(key) } else null
    TodoLine(r, LocalNow.current, { open(r) }, { tick(r) }, lasts = lasts, fold = fold, showRepo = showRepo, showArea = showArea, above = n.above?.title)
    if (!shut) n.kids.forEachIndexed { i, k -> NodeRows(k, depth + 1, closed, toggle, open, showRepo, showArea, lasts + (i == n.kids.lastIndex), tick) }
}

@Composable
internal fun stateColor(s: String): Color? = when (s) {
    TodoRow.STATE_DOING -> Aioa.colors.accent
    TodoRow.STATE_HOLD -> Aioa.colors.warning
    else -> null
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
