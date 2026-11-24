package com.hengxin.aioa.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text

private val CELL_H = 22.dp
private const val GAP_PART = 0.18f
private const val LEVELS = 4
private const val RING_PX = 3f

private fun GhDay.prs() = prOpened + prMerged + prClosed
private fun GhDay.issues() = issueOpened + issueClosed
private fun GhDay.total() = commits + prs() + issues()

/** 最近两周的成绩单: 一行热力格, 点格子看那天的明细。 */
@Composable
fun DailyCard(mine: GithubMine) {
    val d = mine.daily ?: return
    if (d.days.isEmpty()) return
    val c = Aioa.colors
    var picked by rememberSaveable { mutableIntStateOf(-1) }
    val sel = d.days.getOrNull(picked) ?: d.days.last()
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(ICON_GITHUB, c.textSecondary, 16.dp)
            Box(Modifier.weight(1f)) { Text("最近 ${d.days.size} 天", c.text, GH_ROW_SP, weight = FontWeight.Medium) }
            if (d.streak > 1) Text("连续 ${d.streak} 天", c.accent, 13, weight = FontWeight.Medium)
        }
        Row(horizontalArrangement = Arrangement.SpaceBetween) {
            SummaryCell(d.days.sumOf { it.commits }, "提交", Modifier.weight(1f))
            SummaryCell(d.days.sumOf { it.prMerged }, "PR 合入", Modifier.weight(1f), c.success)
            SummaryCell(d.days.sumOf { it.issueClosed }, "Issue 关闭", Modifier.weight(1f), c.warning)
            SummaryCell(d.openPrs + d.openIssues, "待处理", Modifier.weight(1f), if (d.openPrs + d.openIssues > 0) c.danger else c.text)
        }
        HeatStrip(d.days, picked.takeIf { it in d.days.indices } ?: d.days.lastIndex, c.accent, c.border, c.text) { picked = it }
        Paragraph(dayLine(sel), c.text, 13)
    }
}

private fun dayLine(d: GhDay): String {
    val date = d.day.drop(5)
    if (d.total() + d.reviews + d.comments == 0) return "$date: 这天没有动静。"
    val parts = buildList {
        if (d.commits > 0) add("提交 ${d.commits}")
        if (d.prs() > 0) add("PR 新开 ${d.prOpened} 合入 ${d.prMerged}" + if (d.prClosed > 0) " 关闭 ${d.prClosed}" else "")
        if (d.issues() > 0) add("Issue 新开 ${d.issueOpened} 关闭 ${d.issueClosed}")
        if (d.reviews > 0) add("评审 ${d.reviews}")
        if (d.comments > 0) add("评论 ${d.comments}")
    }
    return "$date: " + parts.joinToString(" · ")
}

/** 一天一格, 颜色越深越忙 (按两周里最忙那天分 4 档), 选中的格子描边。 */
@Composable
private fun HeatStrip(days: List<GhDay>, selected: Int, hot: Color, idle: Color, ring: Color, onPick: (Int) -> Unit) {
    val max = (days.maxOfOrNull { it.total() } ?: 0).coerceAtLeast(1)
    Canvas(
        Modifier.fillMaxWidth().height(CELL_H).pointerInput(days.size) {
            detectTapGestures { p -> onPick((p.x / (size.width.toFloat() / days.size)).toInt().coerceIn(0, days.lastIndex)) }
        },
    ) {
        val slot = size.width / days.size
        val w = slot * (1 - GAP_PART)
        val r = CornerRadius(w / 5, w / 5)
        days.forEachIndexed { i, d ->
            val x = i * slot + (slot - w) / 2
            val level = if (d.total() == 0) 0 else 1 + (LEVELS - 1) * d.total() / max
            val color = if (level == 0) idle else hot.copy(alpha = level.coerceAtMost(LEVELS).toFloat() / LEVELS)
            drawRoundRect(color, Offset(x, 0f), Size(w, size.height), r)
            if (i == selected) drawRoundRect(ring, Offset(x, 0f), Size(w, size.height), r, style = Stroke(RING_PX))
        }
    }
}
