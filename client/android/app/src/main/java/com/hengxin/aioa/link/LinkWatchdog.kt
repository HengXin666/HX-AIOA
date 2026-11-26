package com.hengxin.aioa.link

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.hengxin.aioa.Constants

// 后台看门狗: 深睡时 Handler 与 OkHttp 的计时都停住, 只有允许在 Doze 中触发的闹钟能保住 NAT 映射并发现假在线。
// 触发源: 兜底闹钟 (自适应间隔), 亮屏, 网络变化。唤醒锁只覆盖一次探测, 收到 pong 立即释放。
// 心跳间隔从 HEARTBEAT_MIN 起步, 每次探测成功拉长一档, 某一档探测到连接已死就退回上一档并固定, 换网络后重新学习。
class LinkWatchdog(
    private val context: Context,
    private val socket: LinkSocket,
    private val onWake: () -> Unit,
) {

    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val power = context.getSystemService(PowerManager::class.java)
    private val intent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(Constants.ACTION_WATCHDOG).setPackage(context.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    @Volatile
    private var interval = Constants.HEARTBEAT_MIN_MS

    @Volatile
    private var locked = false

    // 离线 / 探测失败时为重连留着的唤醒锁; 重连成功就提前放掉, 不必等到超时
    @Volatile
    private var held: PowerManager.WakeLock? = null

    private val alarmReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, data: Intent) {
            LinkStats.hit(LinkStats.Key.ALARM)
            BatteryLog.sample(context)
            val wake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_TAG)
            wake.acquire(Constants.WATCHDOG_WAKE_MS)
            val tried = interval
            socket.check(tried - SKIP_SLACK_MS) { result -> onAlarmResult(result, tried, wake) }
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
            socket.check(Constants.HEARTBEAT_MIN_MS / 2) { if (it == LinkSocket.Probe.DEAD) LinkLog.add(context, "亮屏检查: 连接已死, 已重连") }
            onWake()
        }
    }

    fun start() {
        ContextCompat.registerReceiver(context, alarmReceiver, IntentFilter(Constants.ACTION_WATCHDOG), ContextCompat.RECEIVER_NOT_EXPORTED)
        ContextCompat.registerReceiver(context, screenReceiver, IntentFilter(Intent.ACTION_SCREEN_ON), ContextCompat.RECEIVER_NOT_EXPORTED)
        arm(interval)
    }

    fun stop() {
        alarms.cancel(intent)
        runCatching { context.unregisterReceiver(alarmReceiver) }
        runCatching { context.unregisterReceiver(screenReceiver) }
    }

    // 换了网络就换了 NAT, 学到的间隔作废
    fun onNetworkChanged() {
        LinkStats.hit(LinkStats.Key.NETWORK)
        interval = Constants.HEARTBEAT_MIN_MS
        locked = false
        arm(interval)
        onWake()
    }

    private fun onAlarmResult(result: LinkSocket.Probe, tried: Long, wake: PowerManager.WakeLock) {
        when (result) {
            LinkSocket.Probe.ALIVE -> {
                LinkStats.hit(LinkStats.Key.PROBE)
                if (!locked && interval < Constants.HEARTBEAT_MAX_MS) {
                    interval = (interval + Constants.HEARTBEAT_STEP_MS).coerceAtMost(Constants.HEARTBEAT_MAX_MS)
                    LinkLog.add(context, "心跳 ${tried / MS_PER_MIN} 分钟可用, 下次试 ${interval / MS_PER_MIN} 分钟")
                }
            }
            LinkSocket.Probe.DEAD -> {
                LinkStats.hit(LinkStats.Key.PROBE_DEAD)
                if (tried > Constants.HEARTBEAT_MIN_MS) {
                    interval = (tried - Constants.HEARTBEAT_STEP_MS).coerceAtLeast(Constants.HEARTBEAT_MIN_MS)
                    locked = true
                    LinkLog.add(context, "心跳 ${tried / MS_PER_MIN} 分钟时连接已断, 固定为 ${interval / MS_PER_MIN} 分钟")
                }
            }
            LinkSocket.Probe.SKIPPED -> LinkStats.hit(LinkStats.Key.PROBE_SKIP)
            LinkSocket.Probe.OFFLINE -> Unit
        }
        // 有流量时从最后一次收到数据算起, 保证两次流量的间隔不超过 interval
        val next = if (result == LinkSocket.Probe.SKIPPED) interval - socket.idleMs() else interval
        arm(next.coerceAtLeast(MIN_ARM_MS))
        LinkStats.flush(context)
        // 离线时留着唤醒锁 (有超时) 给重连用, 连上后由 onOnline 放掉; 其余情况立即释放
        if (result == LinkSocket.Probe.OFFLINE || result == LinkSocket.Probe.DEAD) held = wake
        else if (wake.isHeld) wake.release()
    }

    /** 长连接重新连上: 为重连留的唤醒锁不用再等超时。 */
    fun onOnline() {
        val w = held ?: return
        held = null
        runCatching { if (w.isHeld) w.release() }
    }

    private fun arm(delayMs: Long) {
        alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMs, intent)
    }

    private companion object {
        const val WAKE_TAG = "aioa:watchdog"
        const val MS_PER_MIN = 60_000L
        const val SKIP_SLACK_MS = 30_000L
        const val MIN_ARM_MS = 60_000L
    }
}
