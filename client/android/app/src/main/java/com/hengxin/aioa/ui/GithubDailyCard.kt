package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text

private val RADIAL = 196.dp

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
        // 放射柱 (#140): 两周一圈, 每天一根光线, 越忙越长越亮; 点光线看那天, 中间是那天的总数
        val pal = com.hengxin.aioa.kit.hxPalette()
        val at = picked.takeIf { it in d.days.indices } ?: d.days.lastIndex
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            com.hengxin.aioa.kit.RadialBars(d.days.map { it.total().toFloat() }, pal.chart1, pal.chart2, Modifier.size(RADIAL), highlight = at, delayMs = 150, onPick = { picked = it }) {
                androidx.compose.foundation.layout.Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    com.hengxin.aioa.kit.CountUp(sel.total(), 26, c.text)
                    Text(sel.day.drop(5), c.textSecondary, 12)
                }
            }
        }
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
