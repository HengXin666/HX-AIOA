package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// 所有显示待办的地方共用的一行 (#121): 层级连线, 勾选框或折叠箭头, issue 图标, 标题, 右边压成小标注, 父项进度条
private const val INDENT = 22
private const val ROW_PAD = 8
private const val MARK = 18
private const val BAR_W = 28
private const val START = 12
private const val PRIO_URGENT = 1
private const val GUIDE_ALPHA = 0.5f
private const val TAG_ALPHA = 0.12f
private const val MARK_SP = 11
private val PILL = RoundedCornerShape(50)
private val MARK_SHAPE = RoundedCornerShape(5.dp)
private val DONE_PURPLE = Color(0xFF8250DF)
private val NO_REPO_TINT = Color(0xFF9CA3AF)
private val REPO_TINTS = listOf(0xFF2F6BFF, 0xFF12A150, 0xFFD97706, 0xFF8250DF, 0xFFDB2777, 0xFF0891B2, 0xFF65A30D)
private const val MINUTE_MS = 60_000L
private const val HOUR_MS = 60 * MINUTE_MS
private const val DAY_MS = 24 * HOUR_MS
private const val WEEK_DAYS = 7
private const val TITLE_LINES = 2
private const val MARKS_MAX = 168
private const val UNIT_MONTH = "month"
private val EVERY_UNITS = mapOf("day" to "天", "week" to "周", UNIT_MONTH to "月", "year" to "年")

/** 仓库的固定颜色: 名字哈希到一组好分辨的色; null 为没关联仓库。 */
fun repoTint(repo: String?): Color = if (repo == null) NO_REPO_TINT else Color(REPO_TINTS[repo.hashCode().mod(REPO_TINTS.size)])

/** 倒计时: "还剩 2 天 3 小时" / "逾期 1 天"; 第二项为 true 表示逾期或 24 小时内 (标红)。 */
fun todoCountdown(due: Long, now: Long): Pair<String, Boolean> {
    val left = due - now
    val abs = kotlin.math.abs(left)
    val d = abs / DAY_MS
    val h = (abs % DAY_MS) / HOUR_MS
    val m = (abs % HOUR_MS) / MINUTE_MS
    val span = when {
        d > 0 -> if (h > 0 && d < WEEK_DAYS) "$d 天 $h 小时" else "$d 天"
        h > 0 -> if (m > 0) "$h 小时 $m 分" else "$h 小时"
        else -> "${maxOf(m, 1)} 分钟"
    }
    return (if (left >= 0) "还剩 $span" else "逾期 $span") to (left < DAY_MS)
}

/** 父项的子项进度; shut 为已折叠。 */
data class TodoFold(val done: Int, val total: Int, val shut: Boolean, val toggle: () -> Unit)

/**
 * 一行待办。lasts 为层级路径 (见 [TreePath]), fold 非空时这一行是父项 (左边是折叠箭头, 右边是进度条)。
 * showRepo / showArea 为在标注里写仓库 / 分区 (按仓库或分区分组时不必重复)。
 */
@Composable
fun TodoLine(
    row: TodoRow,
    now: Long,
    onOpen: () -> Unit,
    onTick: () -> Unit,
    modifier: Modifier = Modifier,
    lasts: TreePath = emptyList(),
    fold: TodoFold? = null,
    showRepo: Boolean = false,
    showArea: Boolean = false,
) {
    val c = Aioa.colors
    val depth = lasts.size
    val inset = (START + depth * INDENT).dp
    val open = fold != null && !fold.shut
    Column(modifier.fillMaxWidth().treeGuides(lasts, open, c.textSecondary.copy(alpha = GUIDE_ALPHA), START.dp, INDENT.dp, MARK.dp, (ROW_PAD + 0.5f).dp)) {
        Box(Modifier.fillMaxWidth().padding(start = inset).height(0.5.dp).background(c.border))
        Row(
            Modifier.fillMaxWidth().pressable(onOpen).padding(start = inset, end = 12.dp, top = ROW_PAD.dp, bottom = ROW_PAD.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (fold != null) {
                Box(Modifier.size(MARK.dp).clip(MARK_SHAPE).clickable(onClick = fold.toggle), contentAlignment = Alignment.Center) {
                    Icon(if (fold.shut) "chevron-right" else "chevron-down", c.textSecondary, 15.dp)
                }
            } else {
                Box(Modifier.size(MARK.dp).clip(MARK_SHAPE).clickable(onClick = onTick), contentAlignment = Alignment.Center) {
                    Icon(if (row.finished) "square-check" else "square", if (row.finished) c.success else c.textSecondary, 17.dp)
                }
            }
            row.issue?.let { Icon(if (row.ghOpen == false) "circle-check" else "circle-dot", if (row.ghOpen == false) DONE_PURPLE else c.success, 14.dp) }
            BasicText(
                row.title,
                Modifier.weight(1f),
                style = TextStyle(
                    color = if (row.finished) c.textSecondary else c.text,
                    fontSize = 14.sp,
                    fontWeight = if (fold != null) FontWeight.SemiBold else FontWeight.Normal,
                    textDecoration = if (row.finished) TextDecoration.LineThrough else null,
                ),
                overflow = TextOverflow.Ellipsis,
                // 标题至少两行 (#139), 一行化后长标题只剩半句
                maxLines = TITLE_LINES,
            )
            TodoMarks(row, now, fold, showRepo, showArea)
        }
    }
}

/** 每 n 天 / 周 / 月 / 年; 不认识的单位不写。 */
private fun everyShort(unit: String?, n: Int): String? {
    val u = EVERY_UNITS[unit] ?: return null
    return if (n <= 1) "每$u" else "每 $n ${if (unit == UNIT_MONTH) "个月" else u}"
}

/**
 * 一行右边的小标注: 按要紧程度排, 放不下的往后截掉。
 * 整块最宽 [MARKS_MAX] (#139): 标注再多, 标题也留得出位置, 不会被挤到 0 宽。
 */
@Composable
private fun TodoMarks(r: TodoRow, now: Long, fold: TodoFold?, showRepo: Boolean, showArea: Boolean) {
    val c = Aioa.colors
    Row(Modifier.widthIn(max = MARKS_MAX.dp).clipToBounds(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!r.finished && r.prio == PRIO_URGENT) Icon("flame", c.danger, 12.dp)
        // P2 / P3 也标出来 (旧版就有), P1 用火苗
        if (r.star && !r.finished) Icon("star", c.warning, 12.dp)
        val state = when (r.state) {
            TodoRow.STATE_DOING -> c.accent
            TodoRow.STATE_HOLD -> c.warning
            else -> null
        }
        state?.let { Box(Modifier.size(6.dp).clip(RoundedCornerShape(2.dp)).background(it)) }
        if (!r.finished) r.due?.let { due ->
            val (text, hot) = todoCountdown(due, now)
            TodoPill(text.removePrefix("还剩 "), if (hot) c.danger else c.accent, if (r.alarm) "alarm-clock" else "clock")
        }
        if (!r.finished && r.prio > PRIO_URGENT) Text("P${r.prio}", c.textSecondary, MARK_SP)
        everyShort(r.everyUnit, r.everyN)?.let {
            Icon("repeat", c.textSecondary, 12.dp)
            Text(it, c.textSecondary, MARK_SP)
        }
        if (r.ghComments > 0 && r.ghOpen != false) {
            Icon("message-square", c.textSecondary, 12.dp)
            Text(r.ghComments.toString(), c.textSecondary, MARK_SP)
        }
        if (showArea) Text(r.areaKey, c.textSecondary, MARK_SP)
        if (showRepo) r.repo?.let { repo ->
            Icon("github", repoTint(repo), 12.dp)
            Text(repo.substringAfter('/'), c.textSecondary, MARK_SP)
        }
        r.issue?.let { Text("#$it", c.textSecondary, MARK_SP) }
        if (fold != null) {
            Box(Modifier.width(BAR_W.dp).height(4.dp).clip(PILL).background(c.surfaceAlt)) {
                val f = if (fold.total > 0) fold.done.toFloat() / fold.total else 0f
                Box(Modifier.fillMaxWidth(f).height(4.dp).clip(PILL).background(if (fold.done == fold.total) c.success else c.accent))
            }
            Text("${fold.done}/${fold.total}", c.textSecondary, MARK_SP)
        }
    }
}

/** 小标签: 浅底 + 图标 + 字, 待办的截止等用。 */
@Composable
fun TodoPill(text: String, color: Color, icon: String? = null) {
    Row(Modifier.clip(PILL).background(color.copy(alpha = TAG_ALPHA)).padding(horizontal = 6.dp, vertical = 1.dp), verticalAlignment = Alignment.CenterVertically) {
        icon?.let { Icon(it, color, 11.dp); Spacer(Modifier.width(3.dp)) }
        Text(text, color, MARK_SP, weight = FontWeight.SemiBold)
    }
}
