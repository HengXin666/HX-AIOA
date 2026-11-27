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

/** 一份报告用到的全部本机数据; 上一段只取总量做对比。failed 是读失败的块 (其余照常显示)。 */
class WeekReport(
    val span: ReportSpan,
    val first: LocalDate,
    val days: Int,
    val usage: UsageWeek,
    val prevUsageMs: Long,
    val usageSince: Long?,
    val msgs: MessageWeek,
    val prevMsgs: Int,
    val tally: Map<Tally, LongArray>,
    val battery: BatteryWeek,
    val power: List<PowerParts>,
    val capacityMah: Double?,
    val failed: List<String>,
) {
    fun sum(t: Tally): Long = tally[t]?.sum() ?: 0L

    val powerTotal: PowerParts get() = power.fold(PowerParts.ZERO) { a, b -> a + b }

    /** 同期整机不充电时的掉电 (mAh), 由电量百分比与容量折算; 拿不到容量时为 null。 */
    val deviceMah: Double? get() = capacityMah?.let { (battery.onDrop + battery.offDrop) * it / PCT }

    /** 这一段里有没有任何前台记录; 没有时区分 "还没开始记录" (首周) 与 "这周没打开"。 */
    fun usageState(to: Long): UsageState = when {
        usage.totalMs > 0 -> UsageState.READY
        usageSince == null || usageSince >= to -> UsageState.NOT_STARTED
        else -> UsageState.NONE
    }
}

enum class UsageState { READY, NONE, NOT_STARTED }

private const val PCT = 100.0

/** 全部读本机 (前台会话, 消息库, 计数文件, 电量样本, 耗电采样), 不发请求; 在后台线程调用。每块单独兜底, 一块坏了不拖垮整页。 */
object WeekReports {
    fun load(context: Context, span: ReportSpan, first: LocalDate, isAgent: (String) -> Boolean, zone: ZoneId = ZoneId.systemDefault(), now: Long = System.currentTimeMillis()): WeekReport {
        val days = span.days(first)
        val from = first.atStartOfDay(zone).toInstant().toEpochMilli()
        val to = first.plusDays(days.toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
        val prevFirst = span.first(first, 1)
        val prevFrom = prevFirst.atStartOfDay(zone).toInstant().toEpochMilli()
        val failed = ArrayList<String>()
        fun <T> part(name: String, fallback: T, block: () -> T): T = runCatching(block).getOrElse { e ->
            failed.add("$name: ${e.javaClass.simpleName}${e.message?.let { " $it" }.orEmpty()}")
            fallback
        }
        val log = UsageLog(context)
        val sessions = part("前台时长", emptyList()) { sessionsOf(context, log, prevFrom, minOf(now, to)) }
        val usage = UsageMath.week(sessions, first, zone, days)
        val prevUsage = UsageMath.week(sessions, prevFirst, zone, span.days(prevFirst))
        val since = part("前台时长", null) { listOfNotNull(log.firstStart(), sessions.firstOrNull()?.start).minOrNull() }
        val emptyMsgs = MessageWeekMath.tally(emptyList(), emptySet(), { 0L }, first, zone, days)
        val msgs = part("消息", emptyMsgs to 0) {
            val db = MessageDb.get(context)
            val rows = db.weekRows(from, to)
            val agents = rows.mapNotNullTo(HashSet()) { r -> r.sid?.takeIf(isAgent) }
            val reads = HashMap<String, Long>()
            MessageWeekMath.tally(rows, agents, { g -> reads.getOrPut(g) { db.groupRead(g) } }, first, zone, days) to db.weekRows(prevFrom, from).size
        }
        val tally = part("本机计数", LocalTally.window(emptyMap(), first, days)) { LocalTally.days(context, first, days) }
        val battery = part("电量", BatteryMath.of(emptyList())) { BatteryMath.of(BatteryLog.points(context, from).filter { it.at < to }) }
        val power = part("耗电估算", List(days) { PowerParts.ZERO }) {
            if (to > now) AppPower.sample(context, "ui", now)
            val edges = LongArray(days + 1) { d -> first.plusDays(d.toLong()).atStartOfDay(zone).toInstant().toEpochMilli() }
            PowerModel.buckets(AppPower.samples(context, from, to), sessions, edges)
        }
        val capacity = AppPower.capacityMah(context)
        return WeekReport(span, first, days, usage, prevUsage.totalMs, since, msgs.first, msgs.second, tally, battery, power, capacity, failed.distinct())
    }

    /** 本机记录 + 正在进行的这一次 + 系统记下的本 App 界面事件 (能补上装这一版之前的), 合并去重。 */
    fun sessionsOf(context: Context, log: UsageLog, from: Long, to: Long): List<Session> {
        val mine = log.sessions(from) + listOfNotNull(log.current(to))
        val system = UsageEventsSource.sessions(context, from, to)
        return UsageMath.merge(mine + system).filter { it.end > from }
    }
}
