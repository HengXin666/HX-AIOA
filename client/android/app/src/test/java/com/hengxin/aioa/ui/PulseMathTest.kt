package com.hengxin.aioa.ui

import com.hengxin.aioa.data.WeekRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

class PulseMathTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private fun at(d: Int, h: Int, m: Int = 0) = LocalDateTime.of(2026, 11, d, h, m).atZone(zone).toInstant().toEpochMilli()
    private fun row(ts: Long, mine: Boolean, sid: String? = null) = WeekRow(ts, mine, sid, "s", "g", 0, true)

    // 2026-11-28 是周六, 本周从 11-23 (周一) 起
    private val now = at(28, 14, 30)
    private val rows = listOf(
        row(at(28, 9), true), row(at(28, 9, 20), false, "agent:a"), row(at(28, 14, 5), false, "agent:a"),
        row(at(28, 14, 6), false, "agent:a"), row(at(28, 14, 7), true), row(at(28, 10), false, "user:x"),
        row(at(27, 23), true), row(at(23, 1), false, "agent:a"),
    )

    @Test fun dayBucketsByHourUpToNow() {
        val d = PulseMath.build(PulseSpan.DAY, rows, setOf("agent:a"), listOf(at(28, 9, 30), at(27, 8)), now, zone)
        assertEquals(24, d.labels.size)
        assertEquals(15, d.mine.size)
        assertEquals(2, d.mineTotal)
        assertEquals(3, d.agentTotal)
        assertEquals(1, d.doneTotal)
        assertEquals(14, d.peak)
        assertEquals(3, d.peakCount)
        assertEquals("14:00", d.peakLabel)
    }

    @Test fun weekBucketsFromMonday() {
        val d = PulseMath.build(PulseSpan.WEEK, rows, setOf("agent:a"), emptyList(), now, zone)
        assertEquals(6, d.mine.size)
        assertEquals(1f, d.agent[0])
        assertEquals(1f, d.mine[4])
        assertEquals(5, d.peak)
        assertEquals("周六", d.peakLabel)
        assertEquals(PulseMath.from(PulseSpan.WEEK, java.time.LocalDate.of(2026, 11, 28), zone), at(23, 0))
    }

    @Test fun emptyHasNoPeak() {
        val d = PulseMath.build(PulseSpan.DAY, emptyList(), emptySet(), emptyList(), now, zone)
        assertNull(d.peak)
        assertEquals(0, d.mineTotal)
    }
}
