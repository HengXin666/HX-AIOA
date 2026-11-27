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

    @Test fun mergesOverlapAndShortGaps() {
        // 本机记录与系统事件重叠, 转屏造成的 1 秒空档并成一次, 10 秒以上的空档算两次
        val m = UsageMath.merge(listOf(Session(at(0, 10), at(0, 10, 5)), Session(at(0, 10, 1), at(0, 10, 7)), Session(at(0, 10, 7) + 1_000, at(0, 10, 9)), Session(at(0, 11), at(0, 11, 1))))
        assertEquals(listOf(Session(at(0, 10), at(0, 10, 9)), Session(at(0, 11), at(0, 11, 1))), m)
        assertEquals(2, UsageMath.week(m, first, zone).opens)
    }

    @Test fun systemEventsToSessions() {
        val ev = listOf(
            UiEvent(100, true, "Main"), UiEvent(200, true, "Browser"), UiEvent(210, false, "Main"),
            UiEvent(300, false, "Browser"), UiEvent(310, false, "Browser"), UiEvent(400, true, "Main"),
        )
        assertEquals(listOf(Session(100, 300), Session(400, 500)), UsageEventsSource.toSessions(ev, 500))
        assertEquals(emptyList<Session>(), UsageEventsSource.toSessions(listOf(UiEvent(5, false, "Main")), 9))
    }

    @Test fun emptyAndParse() {
        assertNull(UsageMath.week(emptyList(), first, zone).longest)
        assertNull(UsageLog.parse("5,3"))
        assertEquals(Session(1, 9), UsageLog.parse("1,9"))
    }
}
