package com.hengxin.aioa.data

import android.content.Context
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** 一次前台会话 (#140 周报): App 回到前台到离开前台。 */
data class Session(val start: Long, val end: Long) {
    val ms: Long get() = end - start
}

/** 一周的前台用量: 总时长, 打开次数, 最长一次, 以及 [天][小时] 的前台分钟数 (按设备时区)。 */
class UsageWeek(val totalMs: Long, val opens: Int, val longest: Session?, val minutes: Array<IntArray>)

/**
 * 本机前台会话记录 (#140): 不进数据库也不上传, 每行 "start,end" 追加到 filesDir 下的文件。
 * begin 记下开始时间, end 写一行; 进程被杀没走到 end 的那次在下次 begin 时丢掉。
 */
class UsageLog(context: Context) {
    private val file = File(context.filesDir, FILE)
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun begin(now: Long = System.currentTimeMillis()) {
        prefs.edit().putLong(K_OPEN, now).apply()
    }

    fun end(now: Long = System.currentTimeMillis()) {
        val start = prefs.getLong(K_OPEN, 0L)
        prefs.edit().remove(K_OPEN).apply()
        if (start <= 0L || now - start < MIN_MS || now - start > MAX_MS) return
        synchronized(LOCK) {
            runCatching { file.appendText("$start,$now\n") }
            if (prefs.getLong(K_PRUNED, 0L) < now - PRUNE_EVERY) prune(now)
        }
    }

    fun sessions(since: Long): List<Session> = synchronized(LOCK) {
        if (!file.exists()) return emptyList()
        runCatching { file.readLines().mapNotNull(::parse).filter { it.end > since } }.getOrDefault(emptyList())
    }

    /** 还没走到 end 的这一次 (界面正在前台, 比如正看着周报), 结束时间按 now 算。 */
    fun current(now: Long = System.currentTimeMillis()): Session? {
        val start = prefs.getLong(K_OPEN, 0L)
        return if (start > 0L && now - start in MIN_MS..MAX_MS) Session(start, now) else null
    }

    /** 最早一条记录的开始时间, 用来区分 "这周没用" 与 "还没开始记录"。 */
    fun firstStart(): Long? = synchronized(LOCK) {
        if (!file.exists()) return null
        runCatching { file.bufferedReader().use { r -> r.lineSequence().firstNotNullOfOrNull(::parse)?.start } }.getOrNull()
    }

    private fun prune(now: Long) {
        val keep = sessions(now - KEEP_MS)
        runCatching { file.writeText(keep.joinToString("") { "${it.start},${it.end}\n" }) }
        prefs.edit().putLong(K_PRUNED, now).apply()
    }

    companion object {
        private const val FILE = "usage-sessions.csv"
        private const val PREFS = "usage"
        private const val K_OPEN = "open"
        private const val K_PRUNED = "pruned"
        private const val MIN_MS = 1_000L
        private const val MAX_MS = 86_400_000L
        private const val KEEP_MS = 400L * 86_400_000L
        private const val PRUNE_EVERY = 86_400_000L
        private val LOCK = Any()

        fun parse(line: String): Session? {
            val p = line.split(',')
            val s = p.getOrNull(0)?.toLongOrNull() ?: return null
            val e = p.getOrNull(1)?.toLongOrNull() ?: return null
            return if (e > s) Session(s, e) else null
        }
    }
}

object UsageMath {
    private const val HOURS = 24
    private const val MIN_MS = 60_000L
    // 两段间隔不超过这么久算同一次 (转屏, 切到内置浏览器又回来, 系统记录与本机记录的几百毫秒错位)
    const val JOIN_MS = 5_000L

    /** 多个来源的会话合并: 重叠或间隔 <= JOIN_MS 的并成一次, 按开始时间排序。 */
    fun merge(sessions: List<Session>): List<Session> {
        val out = ArrayList<Session>()
        for (s in sessions.sortedBy { it.start }) {
            val last = out.lastOrNull()
            if (last != null && s.start <= last.end + JOIN_MS) out[out.size - 1] = Session(last.start, maxOf(last.end, s.end)) else out.add(s)
        }
        return out
    }

    /** 从 first 那天 0 点起 days 天, 会话按小时切开累加分钟; 跨窗口的只算窗口内那段。 */
    fun week(sessions: List<Session>, first: LocalDate, zone: ZoneId, days: Int = 7): UsageWeek {
        val from = first.atStartOfDay(zone).toInstant().toEpochMilli()
        val to = first.plusDays(days.toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
        val ms = Array(days) { LongArray(HOURS) }
        var total = 0L
        var opens = 0
        var longest: Session? = null
        for (s in sessions) {
            val a = maxOf(s.start, from)
            val b = minOf(s.end, to)
            if (b <= a) continue
            if (s.start >= from) opens++
            if (longest == null || s.ms > longest.ms) longest = s
            total += b - a
            var t = a
            while (t < b) {
                val at = Instant.ofEpochMilli(t).atZone(zone)
                val next = minOf(b, at.truncatedTo(ChronoUnit.HOURS).plusHours(1).toInstant().toEpochMilli())
                val day = ChronoUnit.DAYS.between(first, at.toLocalDate()).toInt()
                if (day in 0 until days) ms[day][at.hour] += next - t
                t = next
            }
        }
        return UsageWeek(total, opens, longest, Array(days) { d -> IntArray(HOURS) { h -> ((ms[d][h] + MIN_MS / 2) / MIN_MS).toInt() } })
    }
}
