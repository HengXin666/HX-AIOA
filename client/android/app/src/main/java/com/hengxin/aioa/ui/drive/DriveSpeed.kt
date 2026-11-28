package com.hengxin.aioa.ui.drive

// 传输的纯规则 (#158): 速度, 剩余时间, 续传决策, 文件名冲突。不碰安卓, 单测见 DriveSpeedTest

private const val KB = 1024.0
private const val MS = 1000.0
private const val MIN_SEC = 60L
private const val HOUR_SEC = 3600L

/**
 * 滑动窗口平均速度: 只看最近 windowMs 里的样本 (时间, 累计字节), 速度 = 窗口首尾字节差 / 时间差。
 * 比瞬时速度稳, 停下来几秒后会降到 0。
 */
class SpeedMeter(private val windowMs: Long = 5_000) {
    private val samples = ArrayDeque<Pair<Long, Long>>()

    fun add(atMs: Long, bytes: Long) {
        samples.addLast(atMs to bytes)
        while (samples.size > 2 && samples.first().first < atMs - windowMs) samples.removeFirst()
    }

    /** 字节每秒; 样本不够或时间差为 0 时为 0。 */
    fun speed(nowMs: Long = samples.lastOrNull()?.first ?: 0): Double {
        if (samples.size < 2) return 0.0
        val (t0, b0) = samples.first()
        val (_, b1) = samples.last()
        val dt = nowMs - t0
        return if (dt <= 0) 0.0 else (b1 - b0).coerceAtLeast(0) * MS / dt
    }

    fun reset() = samples.clear()
}

/** 剩余秒数; 速度为 0 时为 null (算不出)。 */
fun etaSec(remaining: Long, bytesPerSec: Double): Long? = if (bytesPerSec <= 0.0 || remaining < 0) null else kotlin.math.ceil(remaining / bytesPerSec).toLong()

fun speedText(bytesPerSec: Double): String = when {
    bytesPerSec < KB -> "${bytesPerSec.toLong()} B/s"
    bytesPerSec < KB * KB -> "%.0f KB/s".format(bytesPerSec / KB)
    else -> "%.1f MB/s".format(bytesPerSec / (KB * KB))
}

fun etaText(sec: Long?): String = when {
    sec == null -> "剩余时间未知"
    sec < MIN_SEC -> "剩 $sec 秒"
    sec < HOUR_SEC -> "剩 ${sec / MIN_SEC} 分 ${sec % MIN_SEC} 秒"
    else -> "剩 ${sec / HOUR_SEC} 小时 ${sec % HOUR_SEC / MIN_SEC} 分"
}

/** 收到响应后怎么做。 */
enum class Resume { APPEND, RESTART, RELINK, DONE, RETRY, FAIL }

/**
 * 断点续传的决策: offset 为本地已有字节, size 为文件总大小, relinks 为这轮已换过几次直链。
 * 206 接着写; 200 时服务器不认 Range, 从头写; 403/404/410 是直链过期, 换链再续 (最多 maxRelinks 次);
 * 416 时本地已满就算完成, 否则从头; 429 与 5xx 稍后重试; 其余失败。
 */
fun resumeStep(code: Int, offset: Long, size: Long, relinks: Int, maxRelinks: Int = 2): Resume = when {
    code == HTTP_PARTIAL -> if (offset > 0) Resume.APPEND else Resume.RESTART
    code == HTTP_OK -> Resume.RESTART
    code in RELINK_CODES -> if (relinks < maxRelinks) Resume.RELINK else Resume.FAIL
    code == HTTP_RANGE_BAD -> if (offset >= size) Resume.DONE else Resume.RESTART
    code == HTTP_TOO_MANY || code >= HTTP_SERVER -> Resume.RETRY
    else -> Resume.FAIL
}

/** 续传请求的 Range 头; 从 0 开始时不带。 */
fun rangeHeader(offset: Long): String? = if (offset > 0) "bytes=$offset-" else null

/** 本地的半截比文件还大 (文件被换过) 时作废从头来。 */
fun validOffset(partLength: Long, size: Long): Long = if (partLength in 0..size) partLength else 0

/** 文件名冲突: 已存在就编号成 "a (1).txt", "a (2).txt" ...; 非法字符换成 _。 */
fun uniqueName(name: String, maxTries: Int = 999, exists: (String) -> Boolean): String {
    val safe = name.replace(UNSAFE_NAME, "_").ifBlank { "文件" }
    if (!exists(safe)) return safe
    for (k in 1..maxTries) numbered(safe, k).let { if (!exists(it)) return it }
    return numbered(safe, System.currentTimeMillis().toInt() and Int.MAX_VALUE)
}

private val UNSAFE_NAME = Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]")
private val RELINK_CODES = setOf(403, 404, 410)
private const val HTTP_OK = 200
private const val HTTP_PARTIAL = 206
private const val HTTP_RANGE_BAD = 416
private const val HTTP_TOO_MANY = 429
private const val HTTP_SERVER = 500
