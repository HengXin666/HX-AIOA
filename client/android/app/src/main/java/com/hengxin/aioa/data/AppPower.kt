package com.hengxin.aioa.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.TrafficStats
import android.os.BatteryManager
import android.os.Process
import android.os.SystemClock
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.atomic.AtomicLong

/**
 * 本 App 耗电估算的采样 (#142), 只用第三方能拿到的量, 不加权限:
 * - CPU: Process.getElapsedCpuTime (本进程自启动以来的 CPU 毫秒), 界面进程与 :link 各记各的;
 * - 流量: TrafficStats.getUidRx/TxBytes (本 uid, 两个进程合计, 含长连接), 按采样时的网络类型记成 Wi-Fi 或蜂窝;
 * - 唤醒: :link 看门狗闹钟次数。
 * 搭已有的落盘时机 (界面退后台, :link 看门狗) 采, 本身不制造唤醒; 每个进程一个文件, 一行一个增量。
 */
object AppPower {
    private const val PREFIX = "power-"
    private const val SUFFIX = ".txt"
    private const val UID_MARK = "power-uid.mark"
    private const val TRIM_AT_BYTES = 256 * 1024L
    private const val KEEP_LINES = 6000
    private const val MAH_MIN = 1000.0
    private const val MAH_MAX = 30000.0
    private const val PCT = 100.0
    private const val UAH = 1000.0
    private val lock = Any()
    private val wakes = AtomicLong()

    @Volatile
    private var lastCpu = 0L

    /** :link 看门狗闹钟唤醒一次。 */
    fun wake() {
        wakes.incrementAndGet()
    }

    /** 记一次增量到本进程的文件; proc 区分进程 (ui / link)。 */
    fun sample(context: Context, proc: String, now: Long = System.currentTimeMillis()) {
        runCatching {
            val cpuNow = Process.getElapsedCpuTime()
            val cpu = (cpuNow - lastCpu).coerceAtLeast(0)
            lastCpu = cpuNow
            val net = uidDelta(context)
            val wifi = isCell(context).not()
            val w = wakes.getAndSet(0)
            val s = PowerSample(now, cpu, if (wifi) net else 0, if (wifi) 0 else net, w)
            if (s.cpuMs == 0L && net == 0L && w == 0L) return
            synchronized(lock) {
                val f = File(context.filesDir, PREFIX + proc + SUFFIX)
                f.appendText(format(s))
                if (f.length() > TRIM_AT_BYTES) f.writeText(f.readLines().takeLast(KEEP_LINES).joinToString("\n", postfix = "\n"))
            }
        }
    }

    /** 所有进程在 [from, to) 内的采样, 按时间排序。 */
    fun samples(context: Context, from: Long, to: Long): List<PowerSample> {
        val files = context.filesDir.listFiles { f -> f.name.startsWith(PREFIX) && f.name.endsWith(SUFFIX) }.orEmpty()
        return synchronized(lock) {
            files.flatMap { f -> runCatching { f.readLines().mapNotNull(::parse) }.getOrDefault(emptyList()) }
        }.filter { it.at in from until to }.sortedBy { it.at }
    }

    /** 电池满电容量 (mAh) 估计: 剩余电荷 / 电量百分比; 厂商不给时为 null。 */
    fun capacityMah(context: Context): Double? = runCatching {
        val bm = context.getSystemService(BatteryManager::class.java)
        val counter = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        if (counter <= 0 || pct <= 0) null else (counter / UAH / (pct / PCT)).takeIf { it in MAH_MIN..MAH_MAX }
    }.getOrNull()

    /** 本 uid 收发字节距上一次 (任一进程) 采样的增量; 用文件锁跨进程, 重启后计数清零就整段算新的。 */
    private fun uidDelta(context: Context): Long {
        val uid = Process.myUid()
        val rx = TrafficStats.getUidRxBytes(uid)
        val tx = TrafficStats.getUidTxBytes(uid)
        if (rx < 0 || tx < 0) return 0
        val total = rx + tx
        val boot = System.currentTimeMillis() - SystemClock.elapsedRealtime()
        return RandomAccessFile(File(context.filesDir, UID_MARK), "rw").use { raf ->
            raf.channel.lock().use {
                val old = raf.readLine()?.split(' ')
                val lastTotal = old?.getOrNull(0)?.toLongOrNull()
                val lastBoot = old?.getOrNull(1)?.toLongOrNull()
                raf.setLength(0)
                raf.writeBytes("$total $boot\n")
                uidStep(lastTotal, lastBoot, total, boot)
            }
        }
    }

    /** 第一次没有基准, 不算; 开机时刻变了 (差一分钟以上) 或计数变小说明重启过, 本次计数整段算。 */
    fun uidStep(lastTotal: Long?, lastBoot: Long?, total: Long, boot: Long): Long = when {
        lastTotal == null || lastBoot == null -> 0
        kotlin.math.abs(boot - lastBoot) > BOOT_SLACK_MS || total < lastTotal -> total
        else -> total - lastTotal
    }

    private fun isCell(context: Context): Boolean = runCatching {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }.getOrDefault(false)

    fun format(s: PowerSample) = "${s.at} ${s.cpuMs} ${s.wifiBytes} ${s.cellBytes} ${s.wakes}\n"

    fun parse(line: String): PowerSample? {
        val p = line.trim().split(' ')
        if (p.size != FIELDS) return null
        val v = p.map { it.toLongOrNull() ?: return null }
        if (v.any { it < 0 }) return null
        return PowerSample(v[0], v[1], v[2], v[3], v[4])
    }

    private const val FIELDS = 5
    private const val BOOT_SLACK_MS = 60_000L
}
