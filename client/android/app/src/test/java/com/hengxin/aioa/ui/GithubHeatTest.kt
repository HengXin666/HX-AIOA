package com.hengxin.aioa.ui

import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 总览热力格 (#134): 按周对齐, 级别 0..4, 本周从周一算。 */
class GithubHeatTest {
    private val today = LocalDate.parse("2026-11-27")

    @Test
    fun 格子按周一对齐_最多一档最亮() {
        val h = GhHeatmap(mapOf(today to 8, today.minusDays(1) to 2), 0)
        val levels = heatLevels(h, today)
        val start = today.minusDays((HEAT_DAYS - 1).toLong())
        assertEquals(HEAT_DAYS + start.dayOfWeek.value - 1, levels.size)
        assertEquals(4, levels.last())
        assertEquals(1, levels[levels.size - 2])
        assertTrue(levels.dropLast(2).all { it == 0 })
    }

    @Test
    fun 本周提交从周一算到今天() {
        // 2026-11-27 是周五, 周一是 11-23
        val h = GhHeatmap(mapOf(LocalDate.parse("2026-11-23") to 3, LocalDate.parse("2026-11-22") to 5, today to 1), 0)
        assertEquals(4, weekCommits(h, today))
    }
}
