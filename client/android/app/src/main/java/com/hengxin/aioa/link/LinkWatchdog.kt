package com.hengxin.aioa.link

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.hengxin.aioa.Constants

// 后台看门狗: 深睡时 Handler 与 OkHttp 的计时都停住, 只有允许在 Doze 中触发的闹钟能发现连接已死并补拉。
// 触发源: 固定间隔闹钟, 亮屏, 网络变化。唤醒锁只覆盖一次探测或重连, 收到 pong 立即释放, 重连成功后再留一小会。
// CF 边缘约 100 秒无数据就回收连接 (#149), 闹钟最短也是分钟级, 所以不再按 NAT 学习心跳间隔。
class LinkWatchdog(
    private val context: Context,
    private val socket: LinkSocket,
    private val onWake: () -> Unit,
) {

    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val power = context.getSystemService(PowerManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val intent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(Constants.ACTION_WATCHDOG).setPackage(context.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    // 离线 / 探测失败时为重连留着的唤醒锁; 重连成功就提前放掉, 不必等到超时
    @Volatile
    private var held: PowerManager.WakeLock? = null

    private val alarmReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, data: Intent) {
            LinkStats.hit(LinkStats.Key.ALARM)
            com.hengxin.aioa.data.AppPower.wake()
            BatteryLog.sample(context)
            val wake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_TAG)
            wake.acquire(Constants.WATCHDOG_WAKE_MS)
            socket.check(Constants.LINK_KEEPALIVE_MS) { result -> onAlarmResult(result, wake) }
            onWake()
            // 搭这次唤醒把攒下的调试失败记录发出去, 不另外唤醒
            if (DebugForward.forwardOn(context)) Thread { runCatching { DebugForward.flush(context) } }.start()
        }
    }

    // 亮屏时 CPU 本来就醒着, 只在较久没流量时补一次探测, 让用户打开 App 前就发现死连接
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, data: Intent) {
            LinkStats.hit(LinkStats.Key.SCREEN)
            BatteryLog.sample(context)
            socket.check(Constants.LINK_KEEPALIVE_MS) { if (it == LinkSocket.Probe.DEAD) LinkLog.add(context, "亮屏检查: 连接已死, 已重连") }
            onWake()
        }
    }

    fun start() {
        ContextCompat.registerReceiver(context, alarmReceiver, IntentFilter(Constants.ACTION_WATCHDOG), ContextCompat.RECEIVER_NOT_EXPORTED)
        ContextCompat.registerReceiver(context, screenReceiver, IntentFilter(Intent.ACTION_SCREEN_ON), ContextCompat.RECEIVER_NOT_EXPORTED)
        arm(Constants.WATCHDOG_INTERVAL_MS)
    }

    fun stop() {
        alarms.cancel(intent)
        runCatching { context.unregisterReceiver(alarmReceiver) }
        runCatching { context.unregisterReceiver(screenReceiver) }
    }

    fun onNetworkChanged() {
        LinkStats.hit(LinkStats.Key.NETWORK)
        arm(Constants.WATCHDOG_INTERVAL_MS)
        onWake()
    }

    private fun onAlarmResult(result: LinkSocket.Probe, wake: PowerManager.WakeLock) {
        when (result) {
            LinkSocket.Probe.ALIVE -> LinkStats.hit(LinkStats.Key.PROBE)
            LinkSocket.Probe.DEAD -> LinkStats.hit(LinkStats.Key.PROBE_DEAD)
            LinkSocket.Probe.SKIPPED -> LinkStats.hit(LinkStats.Key.PROBE_SKIP)
            LinkSocket.Probe.OFFLINE -> Unit
        }
        // 有流量时从最后一次收到数据算起, 两次检查之间的空档不超过固定间隔
        val interval = Constants.WATCHDOG_INTERVAL_MS
        val next = if (result == LinkSocket.Probe.SKIPPED) interval - socket.idleMs() else interval
        arm(next.coerceAtLeast(MIN_ARM_MS))
        LinkStats.flush(context)
        // 离线时留着唤醒锁 (有超时) 给重连用, 连上后由 onOnline 放掉; 其余情况立即释放
        if (result == LinkSocket.Probe.OFFLINE || result == LinkSocket.Probe.DEAD) held = wake
        else if (wake.isHeld) wake.release()
    }

    /** 长连接重新连上: 为重连留的唤醒锁不用再等超时, 但再留一小会让补拉帧处理完 (#149)。 */
    fun onOnline() {
        val w = held ?: return
        held = null
        main.postDelayed({ runCatching { if (w.isHeld) w.release() } }, Constants.ONLINE_GRACE_MS)
    }

    private fun arm(delayMs: Long) {
        alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMs, intent)
    }

    private companion object {
        const val WAKE_TAG = "aioa:watchdog"
        const val MIN_ARM_MS = 60_000L
    }
}
