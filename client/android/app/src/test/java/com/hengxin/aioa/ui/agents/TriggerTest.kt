package com.hengxin.aioa.ui.agents

import java.time.Instant
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 与 server/test/trigger.test.ts 同样的用例, 保证安卓移植和 protocol 算法一致。 */
class TriggerTest {
    private val sh = ZoneId.of("Asia/Shanghai")
    private val ny = ZoneId.of("America/New_York")
    private val utc = ZoneId.of("UTC")
    private fun at(s: String) = java.time.OffsetDateTime.parse(s).toInstant().toEpochMilli()
    private fun iso(xs: List<Long>) = xs.map { Instant.ofEpochMilli(it).toString() }

    @Test
    fun 具体时刻跨日() {
        assertEquals(listOf("2026-11-26T10:00:00Z", "2026-11-27T01:00:00Z", "2026-11-27T10:00:00Z"), iso(nextRuns("0 9,18 * * *", at("2026-11-26T10:00:00+08:00"), 3, sh)))
        assertEquals(listOf("2026-11-27T01:00:00Z"), iso(nextRuns("0 9 * * *", at("2026-11-26T09:00:00+08:00"), 1, sh)))
    }

    @Test
    fun 工作日与周末() {
        assertEquals(listOf("2026-11-30T00:30:00Z", "2026-12-01T00:30:00Z"), iso(nextRuns("30 8 * * 1-5", at("2026-11-27T09:00:00+08:00"), 2, sh)))
        val weekend = iso(nextRuns("0 10 * * 6,0", at("2026-11-26T00:00:00Z"), 3, utc))
        assertEquals(listOf("2026-11-28T10:00:00Z", "2026-11-29T10:00:00Z", "2026-12-05T10:00:00Z"), weekend)
        assertEquals(weekend, iso(nextRuns("0 10 * * 6,7", at("2026-11-26T00:00:00Z"), 3, utc)))
    }

    @Test
    fun 步长月底与并集() {
        assertEquals(listOf("09:05", "09:20", "09:35", "09:50"), iso(nextRuns("5-50/15 * * * *", at("2026-11-26T08:59:00Z"), 4, utc)).map { it.substring(11, 16) })
        assertEquals(listOf("2026-12-31", "2027-01-31", "2027-03-31"), iso(nextRuns("0 0 31 * *", at("2026-11-15T00:00:00Z"), 3, utc)).map { it.take(10) })
        assertEquals(listOf("2028-02-29T00:00:00Z"), iso(nextRuns("0 0 29 2 *", at("2026-11-15T00:00:00Z"), 1, utc)))
        assertEquals(emptyList<Long>(), nextRuns("0 0 30 2 *", at("2026-11-15T00:00:00Z"), 1, utc))
        assertEquals(listOf("2026-11-30", "2026-12-01", "2026-12-07"), iso(nextRuns("0 0 1 * 1", at("2026-11-26T12:00:00Z"), 3, utc)).map { it.take(10) })
    }

    @Test
    fun 时区与夏令时() {
        assertEquals(listOf("2026-11-26T14:00:00Z"), iso(nextRuns("0 9 * * *", at("2026-11-26T00:00:00Z"), 1, ny)))
        assertEquals(listOf("2027-03-15T06:30:00Z", "2027-03-16T06:30:00Z"), iso(nextRuns("30 2 * * *", at("2027-03-13T12:00:00Z"), 2, ny)))
        assertEquals(ZoneId.systemDefault(), zoneOf("Mars/Base"))
    }

    @Test
    fun 间隔与无法解析() {
        val base = at("2026-11-26T00:00:00Z")
        assertEquals(listOf(base + 6 * 3_600_000, base + 8 * 3_600_000), nextRuns("every 2h", base + 5 * 3_600_000, 2, utc, base))
        assertEquals(listOf(base + 1_800_000, base + 3_600_000), nextRuns("每 30 分钟", base, 2, utc, base))
        listOf("早上 9 点", "61 * * * *", "0 24 * * *", "0 9 * *", "*/0 * * * *", "5/10 * * * *", "9-5 * * * *").forEach { assertEquals(emptyList<Long>(), nextRuns(it, base, 3, utc), it) }
    }

    @Test
    fun 视图与迟到宽限() {
        val t = AgentTrigger("0 9,18 * * *", null, at("2026-11-20T00:00:00Z"), "Asia/Shanghai")
        val lastRun = at("2026-11-26T09:00:05+08:00")
        val ok = triggerView(t, lastRun, at("2026-11-26T18:20:00+08:00"), sh)
        assertFalse(ok.late)
        assertEquals(at("2026-11-27T09:00:00+08:00"), ok.next)
        assertEquals(listOf(at("2026-11-27T09:00:00+08:00"), at("2026-11-27T18:00:00+08:00")), ok.upcoming)
        assertTrue(triggerView(t, lastRun, at("2026-11-26T18:00:00+08:00") + LATE_GRACE_MAX_MS + 1, sh).late)
        val short = AgentTrigger("every 10m", null, lastRun)
        assertFalse(triggerView(short, lastRun, lastRun + 20 * 60_000, sh).late)
        assertTrue(triggerView(short, lastRun, lastRun + 20 * 60_000 + 1, sh).late)
        assertEquals(UPCOMING_MAX, triggerView(AgentTrigger("*/5 * * * *", null, lastRun, "Asia/Shanghai"), lastRun, lastRun, sh).upcoming.size)
        assertEquals(listOf(at("2026-11-30T09:00:00+08:00")), triggerView(AgentTrigger("0 9 * * 1", null, lastRun, "Asia/Shanghai"), null, lastRun, sh).upcoming)
        assertFalse(triggerView(AgentTrigger("看心情", null, lastRun), lastRun, lastRun).parsed)
    }
}
