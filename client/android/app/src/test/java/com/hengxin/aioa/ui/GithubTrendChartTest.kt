package com.hengxin.aioa.ui

import androidx.compose.ui.graphics.Color
import com.hengxin.aioa.kit.MixStyle
import kotlin.test.Test
import kotlin.test.assertEquals

/** #145: 走势合一图的系列, 左右轴, 显隐, 点同一格收起。 */
class GithubTrendChartTest {
    private val colors = TrendColors(Color.Red, Color.Green, Color.Blue, Color.Cyan, Color.Black, Color.Gray, Color.Yellow, Color.Magenta)
    private val pts = listOf(
        GhTrendPoint("2026-11-27", commits = 80, prOpened = 2, prMerged = 1, prClosed = 1, issueOpened = 3, issueClosed = 2, prComments = 1, issueComments = 4, issueDropped = 1),
        GhTrendPoint("2026-11-28", commits = 3),
    )

    @Test
    fun 提交用右轴_PR_Issue_评论共用左轴() {
        val lines = trendLines(pts, colors)
        assertEquals(listOf("提交"), lines.filter { it.right }.map { it.series.label })
        assertEquals(
            listOf("PR 新开", "PR 合入", "PR 未合入关闭", "Issue 新开", "Issue 关闭完成", "Issue 未完成关闭", "评论"),
            lines.filter { !it.right }.map { it.series.label },
        )
        val v = lines.associate { it.series.label to it.series.values }
        assertEquals(listOf(80f, 3f), v["提交"])
        assertEquals(listOf(1f, 0f), v["PR 未合入关闭"])
        assertEquals(listOf(2f, 0f), v["Issue 关闭完成"])
        assertEquals(listOf(1f, 0f), v["Issue 未完成关闭"])
        assertEquals(listOf(5f, 0f), v["评论"])
        assertEquals(MixStyle.AREA, lines.first().series.style)
        assertEquals(listOf(TG_COMMIT, TG_PR, TG_PR, TG_PR, TG_ISSUE, TG_ISSUE, TG_ISSUE, TG_CMT), lines.map { it.group })
    }

    @Test
    fun 隐藏系列后分轴_只剩提交时挪到左边单轴() {
        val lines = trendLines(pts, colors)
        val (l, r) = trendAxes(lines, setOf("PR 新开", "提交"))
        assertEquals(6, l.size)
        assertEquals(0, r.size)
        val left = lines.filter { !it.right }.map { it.series.label }.toSet()
        val (l2, r2) = trendAxes(lines, left)
        assertEquals(listOf("提交"), l2.map { it.label })
        assertEquals(0, r2.size)
        val (l3, r3) = trendAxes(lines, emptySet())
        assertEquals(7, l3.size)
        assertEquals(1, r3.size)
    }

    @Test
    fun 再点同一格收起() {
        assertEquals(3, trendTap(-1, 3))
        assertEquals(-1, trendTap(3, 3))
        assertEquals(5, trendTap(3, 5))
    }

    @Test
    fun 明细一行带未完成关闭() {
        assertEquals("11-27: 提交 80 · PR 新开 2 合入 1 关闭 1 · Issue 新开 3 关闭 2 未完成关 1 · 评论 5", trendLine(pts[0], false))
    }
}
