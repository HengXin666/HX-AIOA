package com.hengxin.aioa.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class AppPowerTest {
    private val h = 3_600_000L

    @Test fun modelUsesStatedCurrents() {
        // 1 小时前台 = 250 mAh; 1 小时 CPU = 150 mAh; 1 MB Wi-Fi = 8.39 s x 31 mA; 1 MB 蜂窝 = 41.9 s x 200 mA; 1800 次唤醒 = 1 小时 x 50 mA
        val p = PowerModel.parts(h, h, 0, 0, 0)
        assertEquals(250.0, p.screen, 1e-9)
        assertEquals(150.0, p.cpu, 1e-9)
        assertEquals(31.0 * (1_048_576 * 8 / 1e6) / 3600, PowerModel.parts(0, 0, 1_048_576, 0, 0).net, 1e-9)
        assertEquals(200.0 * (1_048_576 * 8 / 2e5) / 3600, PowerModel.parts(0, 0, 0, 1_048_576, 0).net, 1e-9)
        assertEquals(50.0, PowerModel.parts(0, 0, 0, 0, 1800).wake, 1e-9)
        assertEquals(400.0, p.total, 1e-9)
    }

    @Test fun bucketsSplitSessionsAndPlaceSamples() {
        val edges = longArrayOf(0, h, 2 * h)
        val samples = listOf(PowerSample(10, 3_600, 0, 0, 1), PowerSample(h + 5, 7_200, 0, 0, 0), PowerSample(2 * h, 99_999, 0, 0, 0))
        val b = PowerModel.buckets(samples, listOf(Session(h / 2, h + h / 2)), edges)
        assertEquals(2, b.size)
        assertEquals(125.0, b[0].screen, 1e-9)
        assertEquals(125.0, b[1].screen, 1e-9)
        assertEquals(0.15, b[0].cpu, 1e-9)
        assertEquals(0.30, b[1].cpu, 1e-9)
        assertEquals(0.0, b[1].wake, 1e-9)
    }

    @Test fun shareNeedsEnoughDeviceDrain() {
        assertNull(PowerModel.share(5.0, null))
        assertNull(PowerModel.share(5.0, 0.5))
        assertEquals(0.25, PowerModel.share(5.0, 20.0)!!, 1e-9)
        assertEquals(1.0, PowerModel.share(50.0, 20.0)!!, 1e-9)
    }

    @Test fun uidStepHandlesFirstAndReboot() {
        assertEquals(0L, AppPower.uidStep(null, null, 500, 1000))
        assertEquals(200L, AppPower.uidStep(300, 1000, 500, 1000 + 30_000))
        assertEquals(500L, AppPower.uidStep(300, 1000, 500, 1000 + 3_600_000))
        assertEquals(100L, AppPower.uidStep(300, 1000, 100, 1000))
    }

    @Test fun sampleLineRoundTrip() {
        val s = PowerSample(1764280000000, 1234, 56, 78, 2)
        assertEquals(s, AppPower.parse(AppPower.format(s)))
        assertNull(AppPower.parse("1 2 3"))
        assertNull(AppPower.parse("1 -2 3 4 5"))
    }

    @Test fun usageStateTellsFirstWeekFromIdleWeek() {
        val zone = ZoneId.of("Asia/Shanghai")
        val first = LocalDate.of(2026, 11, 23)
        val to = first.plusDays(7).atStartOfDay(zone).toInstant().toEpochMilli()
        fun report(sessions: List<Session>, since: Long?) = WeekReport(
            ReportSpan.WEEK, first, 7, UsageMath.week(sessions, first, zone), 0, since,
            MessageWeekMath.tally(emptyList(), emptySet(), { 0L }, first, zone), 0, LocalTally.window(emptyMap(), first, 7),
            BatteryMath.of(emptyList()), List(7) { PowerParts.ZERO }, null, emptyList(),
        )
        assertEquals(UsageState.NOT_STARTED, report(emptyList(), null).usageState(to))
        assertEquals(UsageState.NOT_STARTED, report(emptyList(), to + 1).usageState(to))
        assertEquals(UsageState.NONE, report(emptyList(), to - 7 * 86_400_000L - 1).usageState(to))
        val s = first.atStartOfDay(zone).toInstant().toEpochMilli() + h
        assertEquals(UsageState.READY, report(listOf(Session(s, s + h)), s).usageState(to))
    }
}
