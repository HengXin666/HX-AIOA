package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.ChartPalette
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.DualMixChart
import com.hengxin.aioa.kit.MixChart
import com.hengxin.aioa.kit.MixLegend
import com.hengxin.aioa.kit.MixSeries
import com.hengxin.aioa.kit.MixStyle
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.chartPalette

// 走势合一图 (#145): 提交, PR, Issue, 评论画在一张双轴图里, PR / Issue / 评论共用左轴, 提交用右轴;
// 图例点选显隐, 可切回 "拆分" (每类一张小图, 选中同一格)。GitHub 页总走势与单仓库页共用
const val TG_COMMIT = "提交"
const val TG_PR = "PR"
const val TG_ISSUE = "Issue"
const val TG_CMT = "评论"
private val COMBINED_H = 210.dp
private val SPLIT_H = 112.dp

/** 一条走势线: 系列, 是否用右轴, 拆分时归哪张小图。 */
data class TrendLine(val series: MixSeries, val right: Boolean, val group: String)

/** 各系列的颜色, 从 chartPalette() 取。 */
data class TrendColors(
    val commit: Color, val pr: Color, val merged: Color, val prDrop: Color,
    val issue: Color, val closed: Color, val issueDrop: Color, val comment: Color,
)

fun trendColors(p: ChartPalette) = TrendColors(p.primary, p.accent, p.success, p.danger, p.amber, p.teal, p.neutral, p.green)

/** 全部走势线, 图例按这个顺序; 新开 = 线, 合入 / 关闭完成 = 柱, 没合入就关 / 未完成就关 = 点。 */
fun trendLines(points: List<GhTrendPoint>, c: TrendColors): List<TrendLine> {
    fun of(name: String, color: Color, style: MixStyle, group: String, right: Boolean = false, f: (GhTrendPoint) -> Int) =
        TrendLine(MixSeries(name, points.map { f(it).toFloat() }, color, style), right, group)
    return listOf(
        of(TG_COMMIT, c.commit, MixStyle.AREA, TG_COMMIT, right = true) { it.commits },
        of("PR 新开", c.pr, MixStyle.LINE, TG_PR) { it.prOpened },
        of("PR 合入", c.merged, MixStyle.BARS, TG_PR) { it.prMerged },
        of("PR 未合入关闭", c.prDrop, MixStyle.DOTS, TG_PR) { it.prClosed },
        of("Issue 新开", c.issue, MixStyle.DASHED, TG_ISSUE) { it.issueOpened },
        of("Issue 关闭完成", c.closed, MixStyle.BARS, TG_ISSUE) { it.issueClosed },
        of("Issue 未完成关闭", c.issueDrop, MixStyle.DOTS, TG_ISSUE) { it.issueDropped },
        of(TG_CMT, c.comment, MixStyle.LINE, TG_CMT) { it.comments },
    )
}

/** 去掉隐藏的系列后分到左右轴; 只剩右轴系列时挪到左边画 (单轴)。 */
fun trendAxes(lines: List<TrendLine>, hidden: Set<String>): Pair<List<MixSeries>, List<MixSeries>> {
    val vis = lines.filter { it.series.label !in hidden }
    val left = vis.filter { !it.right }.map { it.series }
    val right = vis.filter { it.right }.map { it.series }
    return if (left.isEmpty()) right to emptyList() else left to right
}

/** 再点同一格收起提示框, 点别的格换过去。 */
fun trendTap(picked: Int, tapped: Int): Int = if (tapped == picked) -1 else tapped

/**
 * 走势图本体: 合一 / 拆分切换, 可点的图例 (带范围合计), 图; picked < 0 时竖线停在最后一格且不弹提示框。
 * key 区分 GitHub 页与单仓库页, 各记各的显隐与模式。
 */
@Composable
fun TrendPanel(points: List<GhTrendPoint>, weekly: Boolean, picked: Int, onPick: (Int) -> Unit, key: String) {
    if (points.isEmpty()) return
    val c = Aioa.colors
    val pal = chartPalette()
    var split by rememberSaveable(key) { mutableStateOf(false) }
    var hidden by rememberSaveable(key) { mutableStateOf(listOf<String>()) }
    val lines = trendLines(points, trendColors(pal))
    val labels = points.map { trendAxis(it.label) }
    val sel = picked.takeIf { it in points.indices } ?: points.lastIndex
    val tip = if (picked in points.indices) trendAxis(points[picked].label) + if (weekly) " 那周" else "" else null
    val tap = { i: Int -> onPick(trendTap(picked, i)) }
    val off = hidden.toSet()
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Chip("合一", !split) { split = false }
        Chip("拆分", split) { split = true }
    }
    MixLegend(lines.map { it.series }, lines.map { "${it.series.values.sum().toInt()}" }, hidden = off, onToggle = { name ->
        hidden = if (name in hidden) hidden - name else hidden + name
    })
    if (lines.all { it.series.label in off }) return Text("系列都隐藏了, 点上面的图例显示。", c.textSecondary, GH_META_SP)
    if (!split) {
        val (left, right) = trendAxes(lines, off)
        DualMixChart(left, right, labels, height = COMBINED_H, selected = sel, grid = pal.grid, axis = pal.axis, tip = tip, onTap = tap, onSelect = onPick)
        if (right.isNotEmpty()) Text("左轴 PR / Issue / 评论, 右轴提交 (刻度同色)。点或横向拖动看某一格, 再点收起。", c.textSecondary, GH_META_SP)
        return
    }
    // 拆分: 每类一张小图, 各用自己的轴, 选中同一格, 提示框各列各的
    for (g in listOf(TG_COMMIT, TG_PR, TG_ISSUE, TG_CMT)) {
        val shown = lines.filter { it.group == g && it.series.label !in off }.map { it.series }
        if (shown.isEmpty()) continue
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(g, c.text, 13, weight = FontWeight.Medium)
            MixChart(shown, labels, height = SPLIT_H, selected = sel, grid = pal.grid, axis = pal.axis, tip = tip, onTap = tap, onSelect = onPick)
        }
    }
}
