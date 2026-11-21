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

// 后台看门狗: Handler 的延时用的是不含休眠的时钟, 手机深睡时重连定时器和 OkHttp 心跳都会停住,
// 醒来前没人发现连接已经死了。这里用允许在 Doze 中触发的闹钟定期唤醒一次, 持短时唤醒锁做健康检查
class LinkWatchdog(private val context: Context, private val onTick: () -> Unit) {

    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val power = context.getSystemService(PowerManager::class.java)
    private val intent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(Constants.ACTION_WATCHDOG).setPackage(context.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, data: Intent) {
            power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_TAG).acquire(Constants.WATCHDOG_WAKE_MS)
            onTick()
            arm()
        }
    }

    fun start() {
        ContextCompat.registerReceiver(context, receiver, IntentFilter(Constants.ACTION_WATCHDOG), ContextCompat.RECEIVER_NOT_EXPORTED)
        arm()
    }

    fun stop() {
        alarms.cancel(intent)
        runCatching { context.unregisterReceiver(receiver) }
    }

    private fun arm() {
        val at = SystemClock.elapsedRealtime() + Constants.WATCHDOG_INTERVAL_MS
        alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, intent)
    }

    private companion object {
        const val WAKE_TAG = "aioa:watchdog"
    }
}
