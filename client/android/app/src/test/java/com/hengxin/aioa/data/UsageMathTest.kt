package com.hengxin.aioa.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class UsageMathTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private val first = LocalDate.of(2026, 11, 22)
    private fun at(day: Int, h: Int, m: Int = 0) = first.plusDays(day.toLong()).atTime(h, m).atZone(zone).toInstant().toEpochMilli()

    @Test fun splitsAcrossHoursAndDays() {
        val w = UsageMath.week(listOf(Session(at(0, 23, 30), at(1, 0, 45))), first, zone)
        assertEquals(30, w.minutes[0][23])
        assertEquals(45, w.minutes[1][0])
        assertEquals(75L * 60_000, w.totalMs)
        assertEquals(1, w.opens)
    }

    @Test fun clipsToWindow() {
        val w = UsageMath.week(listOf(Session(at(-1, 23), at(0, 1)), Session(at(7, 0), at(7, 2))), first, zone)
        assertEquals(60, w.minutes[0][0])
        assertEquals(0, w.opens)
        assertEquals(60L * 60_000, w.totalMs)
    }

    @Test fun emptyAndParse() {
        assertNull(UsageMath.week(emptyList(), first, zone).longest)
        assertNull(UsageLog.parse("5,3"))
        assertEquals(Session(1, 9), UsageLog.parse("1,9"))
    }
}
