package com.hengxin.aioa.data

import android.content.Context
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** 本机按天累计的计数 (#140 周报): 不进数据库也不上传。 */
enum class Tally {
    REQ, REQ_FAIL, REQ_MS, NET_UP, NET_DOWN, FILE_UP, FILES, TERM, TERM_MS, NOTIFY,
    // 请求耗时分桶 (ms): <25, <50, <100, <200, <400, <800, <1600, <3200, 更慢
    LAT0, LAT1, LAT2, LAT3, LAT4, LAT5, LAT6, LAT7, LAT8,
}

/**
 * 计数先在内存里累加, 搭已有的时机落盘 (界面进程: App 退到后台; :link: 看门狗唤醒与服务销毁), 本身不制造唤醒也不发请求。
 * 每个进程写自己的文件 (tally-<proc>.txt), 读时合并; 一行 "yyyy-MM-dd KIND 值"。进程被杀时没落盘的那一点会丢。
 */
object LocalTally {
    private const val PREFIX = "tally-"
    private const val SUFFIX = ".txt"
    private const val KEEP_DAYS = 400L
    private const val SEP = ' '
    private val pending = ConcurrentHashMap<String, AtomicLong>()
    private val lock = Any()
    val LAT_EDGES = longArrayOf(25, 50, 100, 200, 400, 800, 1600, 3200)
    private val LAT = listOf(Tally.LAT0, Tally.LAT1, Tally.LAT2, Tally.LAT3, Tally.LAT4, Tally.LAT5, Tally.LAT6, Tally.LAT7, Tally.LAT8)

    fun add(kind: Tally, n: Long = 1, at: Long = System.currentTimeMillis()) {
        if (n <= 0) return
        pending.getOrPut(key(dayOf(at), kind)) { AtomicLong() }.addAndGet(n)
    }

    /** 一次 HTTP 请求: 次数, 耗时与分桶, 失败, 已知长度的上下行字节。 */
    fun request(ms: Long, failed: Boolean, up: Long, down: Long) {
        add(Tally.REQ)
        add(Tally.REQ_MS, ms.coerceAtLeast(0))
        add(LAT[latBucket(ms)])
        if (failed) add(Tally.REQ_FAIL)
        add(Tally.NET_UP, up)
        add(Tally.NET_DOWN, down)
    }

    fun latBucket(ms: Long): Int = LAT_EDGES.indexOfFirst { ms < it }.let { if (it < 0) LAT_EDGES.size else it }

    /** 把内存里的计数并进本进程的文件; proc 区分进程 (ui / link)。 */
    fun flush(context: Context, proc: String) {
        if (pending.isEmpty()) return
        synchronized(lock) {
            val f = File(context.filesDir, PREFIX + proc + SUFFIX)
            val map = runCatching { parse(f.readLines()) }.getOrDefault(HashMap())
            val drained = HashMap<String, Long>()
            for (k in pending.keys.toList()) pending.remove(k)?.get()?.let { drained[k] = it }
            drained.forEach { (k, v) -> map[k] = (map[k] ?: 0L) + v }
            val oldest = LocalDate.now().minusDays(KEEP_DAYS).toString()
            runCatching { f.writeText(format(map.filterKeys { it.substringBefore(SEP) >= oldest })) }
        }
    }

    /** 从 first 起 days 天每天的计数 (合并所有进程的文件与本进程还没落盘的)。 */
    fun days(context: Context, first: LocalDate, days: Int): Map<Tally, LongArray> {
        val merged = HashMap<String, Long>()
        val files = context.filesDir.listFiles { f -> f.name.startsWith(PREFIX) && f.name.endsWith(SUFFIX) }.orEmpty()
        synchronized(lock) {
            files.forEach { f -> runCatching { parse(f.readLines()) }.getOrNull()?.forEach { (k, v) -> merged[k] = (merged[k] ?: 0L) + v } }
        }
        pending.forEach { (k, v) -> merged[k] = (merged[k] ?: 0L) + v.get() }
        return window(merged, first, days)
    }

    fun window(map: Map<String, Long>, first: LocalDate, days: Int): Map<Tally, LongArray> {
        val out = Tally.entries.associateWith { LongArray(days) }
        for (d in 0 until days) {
            val day = first.plusDays(d.toLong()).toString()
            Tally.entries.forEach { k -> out.getValue(k)[d] = map[key(day, k)] ?: 0L }
        }
        return out
    }

    /** 分桶里第 q (0..1) 分位落在哪一桶, 返回那一桶的上沿 (最后一桶返回 -1 表示更慢)。 */
    fun percentile(buckets: LongArray, q: Double): Long {
        val total = buckets.sum()
        if (total <= 0) return 0
        var acc = 0L
        buckets.forEachIndexed { i, n ->
            acc += n
            if (acc >= total * q) return LAT_EDGES.getOrElse(i) { -1L }
        }
        return -1
    }

    fun latency(t: Map<Tally, LongArray>): LongArray = LongArray(LAT.size) { t[LAT[it]]?.sum() ?: 0L }

    fun parse(lines: List<String>): HashMap<String, Long> {
        val m = HashMap<String, Long>()
        for (l in lines) {
            val p = l.trim().split(SEP)
            if (p.size != 3) continue
            val v = p[2].toLongOrNull() ?: continue
            m[p[0] + SEP + p[1]] = (m[p[0] + SEP + p[1]] ?: 0L) + v
        }
        return m
    }

    fun format(m: Map<String, Long>): String = m.entries.sortedBy { it.key }.joinToString("") { "${it.key}$SEP${it.value}\n" }

    private fun key(day: String, kind: Tally) = "$day$SEP${kind.name}"

    private fun dayOf(at: Long) = Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()).toLocalDate().toString()
}
