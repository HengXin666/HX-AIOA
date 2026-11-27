package com.hengxin.aioa.data

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class MessageWeekTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private val first = LocalDate.of(2026, 11, 22)
    private fun at(day: Int, h: Int) = first.plusDays(day.toLong()).atTime(h, 0).atZone(zone).toInstant().toEpochMilli()

    @Test fun tallies() {
        val rows = listOf(
            WeekRow(at(0, 9), mine = true, sid = "user:me", src = "我", grp = "g", seq = 1, seen = false),
            WeekRow(at(0, 9), mine = false, sid = "agent:c", src = "Claude", grp = "g", seq = 2, seen = false),
            WeekRow(at(1, 22), mine = false, sid = "agent:c", src = "Claude", grp = "g", seq = 3, seen = true),
            WeekRow(at(2, 23), mine = false, sid = "user:lin", src = "小林", grp = "h", seq = 4, seen = false),
            WeekRow(at(9, 1), mine = false, sid = "user:lin", src = "小林", grp = "h", seq = 5, seen = false),
        )
        val w = MessageWeekMath.tally(rows, setOf("agent:c"), { if (it == "g") 2L else 0L }, first, zone)
        assertEquals(4, w.total)
        assertEquals(1, w.mine)
        assertEquals(2, w.agent)
        assertEquals(1, w.human)
        assertEquals(2, w.viewed)
        assertEquals(2, w.groups)
        assertEquals(2, w.perHour[0][9])
        assertEquals(listOf("agent:c", "user:lin"), w.peers.map { it.sid })
        assertEquals(true, w.peers[0].agent)
    }
}
