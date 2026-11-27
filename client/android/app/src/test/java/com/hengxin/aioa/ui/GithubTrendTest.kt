package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.mixCeil
import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals

/** GitHub 走势 (#142): 合计, 选中一格的明细, 足迹时间, 纵轴上限。 */
class GithubTrendTest {
    // org.json 在本机单测里是空桩, 这里直接构造解析后的数据
    private val days = GhTrendSeries(
        listOf(
            GhTrendPoint("2026-11-27", commits = 74, prOpened = 2, prMerged = 1, issueClosed = 3, prComments = 1, issueComments = 28),
            GhTrendPoint("2026-11-28", commits = 1),
        ),
        7,
    )

    @Test
    fun 合计() {
        assertEquals(75, days.total.commits)
        assertEquals(29, days.total.comments)
        assertEquals(1, days.total.prMerged)
        assertEquals(3, days.total.issueClosed)
    }

    @Test
    fun 明细一行() {
        val p = days.points
        assertEquals("11-27: 提交 74 · PR 新开 2 合入 1 · Issue 新开 0 关闭 3 · 评论 29", trendLine(p[0], false))
        assertEquals("11-28 那周: 提交 1", trendLine(p[1], true))
        assertEquals("11-23: 没有动静。", trendLine(GhTrendPoint("2026-11-23"), false))
    }

    @Test
    fun 足迹时间与纵轴上限() {
        val utc = ZoneId.of("UTC")
        val at = LocalDate.parse("2026-11-26").atStartOfDay(utc).toInstant().toEpochMilli()
        assertEquals("11-26", footDate(at, utc, LocalDate.parse("2026-11-28")))
        assertEquals("2026-11-26", footDate(at, utc, LocalDate.parse("2027-01-02")))
        assertEquals(2f, mixCeil(0f))
        assertEquals(4f, mixCeil(3f))
        assertEquals(10f, mixCeil(10f))
        assertEquals(80f, mixCeil(62f))
        assertEquals(200f, mixCeil(118f))
    }
}
