package com.hengxin.aioa.data

/** 一次采样记下的增量 (#142): 距本进程上一次采样的 CPU 时间, 本 App (uid) 的 Wi-Fi / 蜂窝字节, 闹钟唤醒次数。 */
data class PowerSample(val at: Long, val cpuMs: Long, val wifiBytes: Long, val cellBytes: Long, val wakes: Long)

/** 估算出的分项耗电, 单位 mAh。 */
data class PowerParts(val screen: Double, val cpu: Double, val net: Double, val wake: Double) {
    val total: Double get() = screen + cpu + net + wake

    operator fun plus(o: PowerParts) = PowerParts(screen + o.screen, cpu + o.cpu, net + o.net, wake + o.wake)

    companion object {
        val ZERO = PowerParts(0.0, 0.0, 0.0, 0.0)
    }
}

/**
 * 本 App 耗电估算 (#142)。第三方 App 拿不到 BatteryStats (BATTERY_STATS 是系统签名权限), 只能用自己看得到的量乘电流常量:
 *   电量 (mAh) = 电流 (mA) x 时长 (h), 与系统电池页的算法同一思路, 但常量是 AOSP 示例值, 不是这台手机实测的 power_profile.xml。
 * 常量出处: source.android.com/docs/core/power/values 的 Example value; 字节换算成收发时长沿用旧版 BatteryStatsHelper
 * (MobileRadioPowerCalculator.MOBILE_BPS = 200000, WifiPowerEstimator.WIFI_BPS = 1000000)。只看趋势, 不是实测。
 */
object PowerModel {
    /** cpu.active 示例 100 - 200 mA, 取中间。乘的是本 App 进程的 CPU 时间 (用户态 + 内核态)。 */
    const val CPU_MA = 150.0

    /** screen.on 示例 200 mA + screen.full 示例 100 - 300 mA 的一半 (按中等亮度); 本 App 在前台时整块屏幕算给本 App, 与系统电池页一致。 */
    const val SCREEN_MA = 250.0

    /** wifi.active 示例 31 mA, 按 1 Mbit/s 折算收发时长。 */
    const val WIFI_MA = 31.0
    const val WIFI_BPS = 1_000_000.0

    /** radio.active 示例 100 - 300 mA 取 200, 按 200 kbit/s 折算收发时长; 没算蜂窝的尾巴电流, 偏低。 */
    const val CELL_MA = 200.0
    const val CELL_BPS = 200_000.0

    /** cpu.awake 示例 50 mA; 每次看门狗闹钟按醒 2 秒算 (拿唤醒锁探测一次, 正常一两秒就放)。 */
    const val AWAKE_MA = 50.0
    const val WAKE_S = 2.0

    private const val MS_PER_H = 3_600_000.0
    private const val S_PER_H = 3_600.0
    private const val BITS = 8.0

    fun parts(fgMs: Long, cpuMs: Long, wifiBytes: Long, cellBytes: Long, wakes: Long) = PowerParts(
        screen = SCREEN_MA * fgMs / MS_PER_H,
        cpu = CPU_MA * cpuMs / MS_PER_H,
        net = WIFI_MA * (wifiBytes * BITS / WIFI_BPS) / S_PER_H + CELL_MA * (cellBytes * BITS / CELL_BPS) / S_PER_H,
        wake = AWAKE_MA * WAKE_S * wakes / S_PER_H,
    )

    /**
     * 按 edges 切段 (edges[i] 到 edges[i + 1] 是第 i 段, 如每天 0 点或每小时): 采样按记下的时刻落段,
     * 前台会话按时间切开; 返回 edges.size - 1 段。
     */
    fun buckets(samples: List<PowerSample>, sessions: List<Session>, edges: LongArray): List<PowerParts> {
        val n = (edges.size - 1).coerceAtLeast(0)
        val cpu = LongArray(n)
        val wifi = LongArray(n)
        val cell = LongArray(n)
        val wakes = LongArray(n)
        val fg = LongArray(n)
        for (s in samples) {
            val i = indexOf(edges, s.at)
            if (i < 0) continue
            cpu[i] += s.cpuMs
            wifi[i] += s.wifiBytes
            cell[i] += s.cellBytes
            wakes[i] += s.wakes
        }
        for (s in sessions) for (i in 0 until n) {
            val a = maxOf(s.start, edges[i])
            val b = minOf(s.end, edges[i + 1])
            if (b > a) fg[i] += b - a
        }
        return List(n) { i -> parts(fg[i], cpu[i], wifi[i], cell[i], wakes[i]) }
    }

    private fun indexOf(edges: LongArray, at: Long): Int {
        if (edges.size < 2 || at < edges.first() || at >= edges.last()) return -1
        var i = 0
        while (at >= edges[i + 1]) i++
        return i
    }

    /** 本 App 估算占同期整机掉电的比例 (0..1); 整机掉电太少 (样本不足) 时为 null。 */
    fun share(app: Double, deviceMah: Double?): Double? =
        if (deviceMah == null || deviceMah < 1.0) null else (app / deviceMah).coerceIn(0.0, 1.0)
}
