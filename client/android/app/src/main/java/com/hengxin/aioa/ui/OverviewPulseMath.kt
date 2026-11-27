package com.hengxin.aioa.ui

import com.hengxin.aioa.data.WeekRow
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

// 总览 "你和 Agent 一起" 的分桶 (#142): 今天按小时, 本周按天 (周一起); 纯计算, 不碰数据库与网络

private const val HOURS = 24
private const val WEEK = 7
private val WEEKDAYS = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")
private val DAY_TICKS = listOf(0, 6, 12, 18, 23)

/** 看今天还是本周。 */
enum class PulseSpan(val label: String) { DAY("今天"), WEEK("本周") }

/**
 * 一段的图表数据: labels 是全部格子, mine / agent / done 只到当前这一格 (后面是未来);
 * peak 是 我 + Agent 最多的那一格 (都为 0 时为 null)。
 */
class PulseData(
    val span: PulseSpan,
    val labels: List<String>,
    val ticks: List<Int>,
    val mine: List<Float>,
    val agent: List<Float>,
    val done: List<Float>,
    val peak: Int?,
) {
    val mineTotal: Int get() = mine.sum().toInt()
    val agentTotal: Int get() = agent.sum().toInt()
    val doneTotal: Int get() = done.sum().toInt()
    val peakCount: Int get() = peak?.let { (mine[it] + agent[it]).toInt() } ?: 0

    /** 峰值写成 "14:00" 或 "周三"。 */
    val peakLabel: String? get() = peak?.let { labels[it] }
}

object PulseMath {
    /** 这一段的起点 (毫秒, 本机时区)。 */
    fun from(span: PulseSpan, today: LocalDate, zone: ZoneId): Long = when (span) {
        PulseSpan.DAY -> today
        PulseSpan.WEEK -> today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    }.atStartOfDay(zone).toInstant().toEpochMilli()

    /** 某个时刻落在第几格; 不在这一段里返回 -1。按日历算, 夏令时那天也不会错位。 */
    fun slot(span: PulseSpan, ts: Long, first: LocalDate, zone: ZoneId): Int {
        val t = Instant.ofEpochMilli(ts).atZone(zone)
        val d = ChronoUnit.DAYS.between(first, t.toLocalDate()).toInt()
        return when (span) {
            PulseSpan.DAY -> if (d == 0) t.hour else -1
            PulseSpan.WEEK -> if (d in 0 until WEEK) d else -1
        }
    }

    /**
     * rows: 这一段的消息 (MessageDb.weekRows); agentSids: 云 Agent 的来源 id;
     * doneAt: 已完成待办的完成时刻。now 之后的格子不出值。
     */
    fun build(span: PulseSpan, rows: List<WeekRow>, agentSids: Set<String>, doneAt: List<Long>, now: Long, zone: ZoneId): PulseData {
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val first = if (span == PulseSpan.DAY) today else today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val n = if (span == PulseSpan.DAY) HOURS else WEEK
        val cur = slot(span, now, first, zone).coerceIn(0, n - 1)
        val mine = FloatArray(cur + 1)
        val agent = FloatArray(cur + 1)
        val done = FloatArray(cur + 1)
        for (r in rows) {
            val i = slot(span, r.ts, first, zone)
            if (i !in 0..cur) continue
            if (r.mine) mine[i]++ else if (r.sid != null && r.sid in agentSids) agent[i]++
        }
        for (t in doneAt) {
            val i = slot(span, t, first, zone)
            if (i in 0..cur) done[i]++
        }
        var peak: Int? = null
        var best = 0f
        for (i in 0..cur) {
            val v = mine[i] + agent[i]
            if (v > best) { best = v; peak = i }
        }
        val labels = if (span == PulseSpan.DAY) List(HOURS) { "${it.toString().padStart(2, '0')}:00" } else WEEKDAYS
        val ticks = if (span == PulseSpan.DAY) DAY_TICKS else (0 until WEEK).toList()
        return PulseData(span, labels, ticks, mine.toList(), agent.toList(), done.toList(), peak)
    }
}

/** 到今天为止连续有消息的天数; 今天还没消息就从昨天往前数。 */
internal fun streakOf(perDay: Map<String, Int>, today: LocalDate): Int {
    var d = if ((perDay[today.toString()] ?: 0) > 0) today else today.minusDays(1)
    var n = 0
    while ((perDay[d.toString()] ?: 0) > 0) {
        n++
        d = d.minusDays(1)
    }
    return n
}
