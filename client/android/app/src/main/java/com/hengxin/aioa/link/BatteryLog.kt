package com.hengxin.aioa.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.PowerManager
import androidx.core.content.ContextCompat
import java.io.File

// 电量采样: 只搭已有的唤醒 (看门狗闹钟, 亮屏, 熄屏, 建连) 读一次系统粘性广播, 本身不制造唤醒。
// 一行一个样本: 时间 电量 是否充电 是否亮屏; 用相邻样本算亮屏 / 熄屏各自每小时掉多少电。
object BatteryLog {
    private const val FILE_NAME = "battery_log.txt"
    private const val KEEP_LINES = 1500
    private const val TRIM_AT_BYTES = 64 * 1024L
    // 两个样本间隔超过这个值 (进程被杀, 关机) 就不计入
    private const val MAX_GAP_MS = 60 * 60_000L
    private const val MS_PER_HOUR = 3_600_000.0
    private const val WINDOW_MS = 24 * 3_600_000L
    private val lock = Any()

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, data: Intent) = sample(ctx)
    }

    /** :link 启动时调用: 熄屏也采一次, 亮屏已由看门狗采。 */
    fun start(context: Context) {
        ContextCompat.registerReceiver(context, screenReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED)
        sample(context)
    }

    fun stop(context: Context) {
        runCatching { context.unregisterReceiver(screenReceiver) }
    }

    fun sample(context: Context) {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return
        val level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level < 0 || scale <= 0) return
        val pct = level * 100 / scale
        val plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
        val screen = context.getSystemService(PowerManager::class.java).isInteractive
        synchronized(lock) {
            runCatching {
                val file = file(context)
                file.appendText("${System.currentTimeMillis()} $pct ${flag(plugged)} ${flag(screen)}\n")
                if (file.length() > TRIM_AT_BYTES) file.writeText(file.readLines().takeLast(KEEP_LINES).joinToString("\n", postfix = "\n"))
            }
        }
    }

    /** 近 24 小时 (不含充电) 亮屏与熄屏各自的时长与掉电。 */
    fun summary(context: Context): List<String> {
        val since = System.currentTimeMillis() - WINDOW_MS
        val rows = runCatching { file(context).readLines() }.getOrDefault(emptyList()).mapNotNull(::parse).filter { it.at >= since }
        if (rows.size < 2) return listOf("采样不足, 后台服务运行一段时间后再看")
        val on = Span()
        val off = Span()
        rows.zipWithNext { a, b ->
            val gap = b.at - a.at
            if (gap <= 0 || gap > MAX_GAP_MS || a.plugged || b.plugged) return@zipWithNext
            val span = if (a.screen) on else off
            span.ms += gap
            span.drop += (a.pct - b.pct).coerceAtLeast(0)
        }
        return listOf(line("亮屏", on), line("熄屏", off), "样本 ${rows.size} 个, 充电时段与超过 1 小时的空档不计")
    }

    /** 调试页的电量曲线 (#139): 近 24 小时的样本 (时间, 电量, 充电, 亮屏), 从早到晚。 */
    data class Point(val at: Long, val pct: Int, val plugged: Boolean, val screen: Boolean)

    fun points(context: Context): List<Point> {
        val since = System.currentTimeMillis() - WINDOW_MS
        return runCatching { file(context).readLines() }.getOrDefault(emptyList()).mapNotNull(::parse).filter { it.at >= since }
            .map { Point(it.at, it.pct, it.plugged, it.screen) }
    }

    private class Span(var ms: Long = 0, var drop: Int = 0)

    private data class Row(val at: Long, val pct: Int, val plugged: Boolean, val screen: Boolean)

    private fun line(label: String, s: Span): String {
        val hours = s.ms / MS_PER_HOUR
        if (hours < 0.1) return "$label: 时长不足"
        return "%s %.1f 小时, 掉 %d%%, 约 %.1f%%/小时".format(label, hours, s.drop, s.drop / hours)
    }

    private fun parse(line: String): Row? {
        val p = line.trim().split(' ')
        if (p.size < 4) return null
        return Row(p[0].toLongOrNull() ?: return null, p[1].toIntOrNull() ?: return null, p[2] == ON, p[3] == ON)
    }

    private const val ON = "1"
    private fun flag(b: Boolean) = if (b) ON else "0"

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
