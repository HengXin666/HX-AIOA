package com.hengxin.aioa.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class StreakTest {
    private val today = LocalDate.of(2026, 11, 28)

    private fun heat(vararg c: Int) = GhHeatmap(c.withIndex().associate { (i, n) -> today.minusDays((c.size - 1 - i).toLong()) to n }, 0)

    @Test fun streakCountsBackFromToday() = assertEquals(3, heatStreak(heat(1, 0, 2, 1, 4), today))

    @Test fun streakSkipsEmptyToday() = assertEquals(2, heatStreak(heat(0, 3, 1, 0), today))

    @Test fun streakForMessagesUsesDayKeys() = assertEquals(2, streakOf(mapOf("2026-11-27" to 5, "2026-11-28" to 1, "2026-11-25" to 9), today))

    @Test fun todayIndexIncludesWeekPad() {
        val h = heat(1, 1, 1)
        val pad = h.days.keys.min().dayOfWeek.value - 1
        assertEquals(pad + 2, todayIndex(h, today))
    }
}
