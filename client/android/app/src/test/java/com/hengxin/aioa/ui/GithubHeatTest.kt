package com.hengxin.aioa.ui

import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** GitHub 页热力格 (#134): 按周对齐, 级别 0..4, 本周从周一算, 按年切换的年份与回填进度。 */
class GithubHeatTest {
    private val today = LocalDate.parse("2026-11-27")

    private fun recent(vararg counts: Pair<LocalDate, Int>): GhHeatmap {
        val start = today.minusDays((HEAT_DAYS - 1).toLong())
        val m = (0 until HEAT_DAYS).associate { start.plusDays(it.toLong()) to 0 } + counts
        return GhHeatmap(m, 0)
    }

    @Test
    fun 格子按周一对齐_最多一档最亮() {
        val levels = heatLevels(recent(today to 8, today.minusDays(1) to 2))
        val start = today.minusDays((HEAT_DAYS - 1).toLong())
        assertEquals(HEAT_DAYS + start.dayOfWeek.value - 1, levels.size)
        assertEquals(4, levels.last())
        assertEquals(1, levels[levels.size - 2])
        assertTrue(levels.dropLast(2).all { it == 0 || it == HEAT_PAD })
    }

    @Test
    fun 本周提交从周一算到今天() {
        // 2026-11-27 是周五, 周一是 11-23
        val h = GhHeatmap(mapOf(LocalDate.parse("2026-11-23") to 3, LocalDate.parse("2026-11-22") to 5, today to 1), 0)
        assertEquals(4, weekCommits(h, today))
    }

    @Test
    fun 按年_回填进度与周对齐() {
        val h = GhHeatmap(linkedMapOf(LocalDate.parse("2019-01-01") to 1, LocalDate.parse("2019-01-02") to 3), 5, listOf(2026, 2019), 2, "2018-05-01")
        assertEquals("正在回填历史提交, 还有 2 个仓库", backfillLine(h))
        assertEquals("历史提交已覆盖到 2018-05-01", backfillLine(h.copy(pending = 0)))
        assertEquals(null, backfillLine(h.copy(pending = 0, oldest = null)))
        // 2019-01-01 是周二, 前面补一格 (不画)
        assertEquals(listOf(HEAT_PAD, 2, 4), heatLevels(h))
    }

    @Test
    fun 按年_首列只画本年的格_上一年的补位格不画() {
        // #145: 2026-01-01 是周四, 首列前 3 格 (周一到周三) 是 2025 年, 标成补位不画; 1 月 1 日落在第 4 格
        val start = LocalDate.parse("2026-01-01")
        val today = LocalDate.parse("2026-11-28")
        val n = (today.toEpochDay() - start.toEpochDay() + 1).toInt()
        val h = GhHeatmap((0 until n).associate { start.plusDays(it.toLong()) to 0 }, 0, listOf(2026))
        val levels = heatLevels(h)
        assertEquals(listOf(HEAT_PAD, HEAT_PAD, HEAT_PAD), levels.take(3))
        assertTrue(levels.drop(3).none { it == HEAT_PAD })
        assertEquals(n + 3, levels.size)
        assertEquals(3, todayIndex(h, start))
    }

    @Test
    fun 服务端补到周一_第一列不留空格_有提交的天都着色() {
        // #144: 11-28 (周六) 往前 140 天从 07-12 (周日) 起, 第一列补 6 个空格, 07-06..07-11 其实有提交;
        // 服务端改成补到 07-06 (周一) 后, 不再补空格, 每个有提交的日子都有颜色
        val today = LocalDate.parse("2026-11-28")
        val start = LocalDate.parse("2026-07-06")
        val n = (today.toEpochDay() - start.toEpochDay() + 1).toInt()
        val m = (0 until n).associate { start.plusDays(it.toLong()) to (it % 5 + 1) }
        val h = GhHeatmap(m, 0)
        val levels = heatLevels(h)
        assertEquals(n, levels.size)
        assertTrue(levels.all { it > 0 })
        assertEquals(n - 1, todayIndex(h, today))
    }
}
