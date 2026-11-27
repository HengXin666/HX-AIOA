package com.hengxin.aioa.data

import android.content.Context
import com.hengxin.aioa.link.BatteryLog
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/** 报告的跨度 (#140): 先做周报; 月报 / 年报只是天数与起点不同, 留着结构, 界面里暂不开放。 */
enum class ReportSpan(val label: String, val ready: Boolean) {
    WEEK("周报", true),
    MONTH("月报", false),
    YEAR("年报", false);

    /** 包含 today 的那一段往前数 back 段的第一天。 */
    fun first(today: LocalDate, back: Int = 0): LocalDate = when (this) {
        WEEK -> today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).minusWeeks(back.toLong())
        MONTH -> today.withDayOfMonth(1).minusMonths(back.toLong())
        YEAR -> today.withDayOfYear(1).minusYears(back.toLong())
    }

    fun days(first: LocalDate): Int = when (this) {
        WEEK -> WEEK_DAYS
        MONTH -> first.lengthOfMonth()
        YEAR -> first.lengthOfYear()
    }
}

private const val WEEK_DAYS = 7
private const val MAX_GAP_MS = 60 * 60_000L

/** 电量: 不充电时亮屏 / 熄屏各自的时长与掉电, 以及曲线用的样本。 */
class BatteryWeek(val onMs: Long, val onDrop: Int, val offMs: Long, val offDrop: Int, val points: List<BatteryLog.Point>) {
    fun perHour(ms: Long, drop: Int): Double? = if (ms < HOUR_MS / 10) null else drop * HOUR_MS.toDouble() / ms

    companion object {
        const val HOUR_MS = 3_600_000L
    }
}

object BatteryMath {
    /** 相邻样本间隔超过 1 小时 (进程被杀, 关机) 或在充电的段不计。 */
    fun of(points: List<BatteryLog.Point>): BatteryWeek {
        var onMs = 0L
        var offMs = 0L
        var onDrop = 0
        var offDrop = 0
        points.zipWithNext { a, b ->
            val gap = b.at - a.at
            if (gap <= 0 || gap > MAX_GAP_MS || a.plugged || b.plugged) return@zipWithNext
            val drop = (a.pct - b.pct).coerceAtLeast(0)
            if (a.screen) { onMs += gap; onDrop += drop } else { offMs += gap; offDrop += drop }
        }
        return BatteryWeek(onMs, onDrop, offMs, offDrop, points)
    }
}

/** 一份报告用到的全部本机数据; 上一段只取总量做对比。 */
class WeekReport(
    val span: ReportSpan,
    val first: LocalDate,
    val days: Int,
    val usage: UsageWeek,
    val prevUsageMs: Long,
    val msgs: MessageWeek,
    val prevMsgs: Int,
    val tally: Map<Tally, LongArray>,
    val battery: BatteryWeek,
) {
    fun sum(t: Tally): Long = tally[t]?.sum() ?: 0L
}

/** 全部读本机 (前台会话文件, 消息库, 计数文件, 电量样本), 不发请求; 在后台线程调用。 */
object WeekReports {
    fun load(context: Context, span: ReportSpan, first: LocalDate, isAgent: (String) -> Boolean, zone: ZoneId = ZoneId.systemDefault()): WeekReport {
        val days = span.days(first)
        val from = first.atStartOfDay(zone).toInstant().toEpochMilli()
        val to = first.plusDays(days.toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
        val prevFirst = span.first(first, 1)
        val prevFrom = prevFirst.atStartOfDay(zone).toInstant().toEpochMilli()
        val log = UsageLog(context)
        val sessions = log.sessions(prevFrom)
        val usage = UsageMath.week(sessions, first, zone, days)
        val prevUsage = UsageMath.week(sessions, prevFirst, zone, span.days(prevFirst))
        val db = MessageDb.get(context)
        val rows = db.weekRows(from, to)
        val agents = rows.mapNotNullTo(HashSet()) { r -> r.sid?.takeIf(isAgent) }
        val reads = HashMap<String, Long>()
        val msgs = MessageWeekMath.tally(rows, agents, { g -> reads.getOrPut(g) { db.groupRead(g) } }, first, zone, days)
        val prevMsgs = db.weekRows(prevFrom, from).size
        val tally = LocalTally.days(context, first, days)
        val battery = BatteryMath.of(BatteryLog.points(context, from).filter { it.at < to })
        return WeekReport(span, first, days, usage, prevUsage.totalMs, msgs, prevMsgs, tally, battery)
    }
}
