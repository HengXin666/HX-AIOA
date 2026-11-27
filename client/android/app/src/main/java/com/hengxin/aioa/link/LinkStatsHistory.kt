package com.hengxin.aioa.link

import android.content.Context
import java.io.File

/**
 * 连接与唤醒计数的快照 (#141): LinkStats 落盘时顺带记一行 "时间 计数...", 至少隔 10 分钟一行, 留 7 天。
 * 调试页用相邻两行的差把计数摊到时间线上; 本身不制造唤醒。
 */
object LinkStatsHistory {
    private const val FILE_NAME = "link_stats_hist.txt"
    private const val MIN_GAP_MS = 10 * 60_000L
    private const val KEEP_MS = 7 * 86_400_000L
    private const val TRIM_AT_BYTES = 160 * 1024L
    private val lock = Any()

    @Volatile
    private var last = 0L

    data class Snap(val at: Long, val counts: List<Int>)

    fun snap(context: Context, counts: List<Int>, now: Long = System.currentTimeMillis()) {
        synchronized(lock) {
            val f = file(context)
            if (last == 0L) last = runCatching { f.readLines().lastOrNull()?.let(::parse)?.at }.getOrNull() ?: 0L
            if (now - last < MIN_GAP_MS) return
            last = now
            runCatching {
                f.appendText("$now ${counts.joinToString(" ")}\n")
                if (f.length() > TRIM_AT_BYTES) f.writeText(f.readLines().mapNotNull(::parse).filter { it.at >= now - KEEP_MS }.joinToString("") { line(it) })
            }
        }
    }

    fun read(context: Context, since: Long): List<Snap> = synchronized(lock) {
        runCatching { file(context).readLines().mapNotNull(::parse).filter { it.at >= since } }.getOrDefault(emptyList())
    }

    /**
     * 把 [from, to) 切成 buckets 段, 每个 key 的增量算到后一次快照所在的段。
     * 计数被清零 (差为负) 时把后一次的值整个算进去。
     */
    fun spread(snaps: List<Snap>, key: Int, from: Long, to: Long, buckets: Int): IntArray {
        val out = IntArray(buckets)
        if (to <= from) return out
        snaps.sortedBy { it.at }.zipWithNext { a, b ->
            if (b.at < from || b.at >= to) return@zipWithNext
            val x = b.counts.getOrElse(key) { 0 }
            val d = x - a.counts.getOrElse(key) { 0 }
            out[((b.at - from) * buckets / (to - from)).toInt()] += if (d < 0) x else d
        }
        return out
    }

    fun parse(line: String): Snap? {
        val p = line.trim().split(' ')
        if (p.size < 2) return null
        val at = p[0].toLongOrNull() ?: return null
        return Snap(at, p.drop(1).map { it.toIntOrNull() ?: return null })
    }

    private fun line(s: Snap) = "${s.at} ${s.counts.joinToString(" ")}\n"

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
