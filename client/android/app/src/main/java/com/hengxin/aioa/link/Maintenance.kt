package com.hengxin.aioa.link

import android.content.Context
import android.os.PowerManager
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.net.ProxyController
import com.hengxin.aioa.net.ProxyCore
import com.hengxin.aioa.net.Subscription
import com.hengxin.aioa.update.Updater
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.atomic.AtomicBoolean

// 低频维护: 检查更新 (6 小时) 与订阅刷新 (超过 24 小时才下) 合并成一次, 不设自己的闹钟,
// 只搭看门狗闹钟, 亮屏, 网络变化这些已经发生的唤醒; 上次执行时间落盘, 进程重启不会重复跑
class Maintenance(private val context: Context, private val io: ExecutorService) {

    private val running = AtomicBoolean(false)
    private val power = context.getSystemService(PowerManager::class.java)
    private val startedAt = System.currentTimeMillis()

    fun runIfDue() {
        val now = System.currentTimeMillis()
        if (now - startedAt < Constants.MAINTENANCE_FIRST_DELAY_MS) return
        if (now - lastRun() < Constants.UPDATE_INTERVAL_MS) return
        if (!running.compareAndSet(false, true)) return
        io.execute {
            val wake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_TAG)
            wake.acquire(Constants.MAINTENANCE_WAKE_MS)
            try {
                LinkStats.hit(LinkStats.Key.MAINTENANCE)
                markRun()
                refreshSubscription()
                runCatching { Updater(context).update(foreground = false) { } }
                    .onFailure { LinkLog.add(context, "维护: 检查更新失败 ${it.message.orEmpty()}") }
            } finally {
                if (wake.isHeld) wake.release()
                running.set(false)
            }
        }
    }

    // 内核没在跑就只下载文件, 下次按需启动时自然读到新订阅, 不为刷新订阅专门拉起内核
    private fun refreshSubscription() {
        val config = ConfigStore.load(context) ?: return
        if (!config.proxyEnabled || !Subscription.stale(context)) return
        val status = Subscription.download(context, config.subscription)
        LinkLog.add(context, "维护: ${status.text}")
        if (status.ok && ProxyCore.listening()) ProxyController(context).refreshSubscription()
    }

    private fun lastRun(): Long = runCatching { stamp().readText().trim().toLong() }.getOrDefault(0L)

    private fun markRun() = runCatching { stamp().writeText(System.currentTimeMillis().toString()) }

    private fun stamp() = File(context.filesDir, STAMP_FILE)

    private companion object {
        const val STAMP_FILE = "maintenance_at"
        const val WAKE_TAG = "aioa:maintenance"
    }
}
