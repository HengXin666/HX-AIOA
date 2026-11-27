package com.hengxin.aioa.data

import com.hengxin.aioa.link.BatteryLog
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class WeekReportTest {
    @Test fun spanFirstDays() {
        val thu = LocalDate.of(2026, 11, 26)
        assertEquals(LocalDate.of(2026, 11, 23), ReportSpan.WEEK.first(thu))
        assertEquals(LocalDate.of(2026, 11, 16), ReportSpan.WEEK.first(thu, 1))
        assertEquals(LocalDate.of(2026, 10, 1), ReportSpan.MONTH.first(thu, 1))
        assertEquals(7, ReportSpan.WEEK.days(thu))
        assertEquals(30, ReportSpan.MONTH.days(LocalDate.of(2026, 11, 1)))
    }

    @Test fun tallyWindowAndFormat() {
        val m = LocalTally.parse(listOf("2026-11-23 REQ 5", "2026-11-23 REQ 2", "2026-11-25 NOTIFY 3", "bad line", "2026-11-30 REQ 9"))
        val w = LocalTally.window(m, LocalDate.of(2026, 11, 23), 7)
        assertEquals(7L, w.getValue(Tally.REQ)[0])
        assertEquals(3L, w.getValue(Tally.NOTIFY)[2])
        assertEquals(7L, w.getValue(Tally.REQ).sum())
        assertEquals(m, LocalTally.parse(LocalTally.format(m).lines()))
    }

    @Test fun latencyBuckets() {
        assertEquals(0, LocalTally.latBucket(10))
        assertEquals(2, LocalTally.latBucket(50))
        assertEquals(8, LocalTally.latBucket(5000))
        val b = longArrayOf(0, 10, 80, 5, 3, 2, 0, 0, 0)
        assertEquals(100L, LocalTally.percentile(b, 0.5))
        assertEquals(200L, LocalTally.percentile(b, 0.95))
        assertEquals(0L, LocalTally.percentile(LongArray(9), 0.5))
    }

    @Test fun batterySkipsChargingAndGaps() {
        val h = BatteryWeek.HOUR_MS
        val pts = listOf(
            BatteryLog.Point(0, 90, false, true),
            BatteryLog.Point(h / 2, 86, false, false),
            BatteryLog.Point(h, 85, false, false),
            BatteryLog.Point(h * 3, 80, false, false),
            BatteryLog.Point(h * 3 + 1000, 81, true, false),
        )
        val b = BatteryMath.of(pts)
        assertEquals(h / 2, b.onMs)
        assertEquals(4, b.onDrop)
        assertEquals(h / 2, b.offMs)
        assertEquals(1, b.offDrop)
        assertEquals(8.0, b.perHour(b.onMs, b.onDrop)!!, 0.001)
    }
}
