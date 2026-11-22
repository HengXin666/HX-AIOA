package com.hengxin.aioa.net

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.AppConfig
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.link.LinkLog
import com.hengxin.aioa.link.LinkStats

// 代理内核的生命周期与节点优选, 只在 :link 进程里运行
// 长连接走代理时内核常驻; 否则按需启动 (更新下载, 设置页, 界面请求), 空闲 PROXY_IDLE_STOP_MS 后停掉
// 测速不再定时跑: 启动内核时测一次, 长连接断开时 (有防抖) 再测, 内核一直在跑时超过 PROXY_OPTIMIZE_MAX_AGE_MS 才重测
// onChanged 只在长连接走代理且代理可用性变化时回调, 让长连接改走新路径
class NodePicker(private val context: Context, private val onChanged: () -> Unit) {

    private val thread = HandlerThread(THREAD_NAME).apply { start() }
    private val handler = Handler(thread.looper)
    private val core = ProxyCore(context)
    private var lastRun = 0L
    private val idleStop = Runnable { stopIfIdle() }

    fun start() = handler.post {
        if (resident(ConfigStore.load(context))) bringUp()
    }

    // fresh: 订阅地址变了, 先趁旧内核还在时下载新订阅再重启; 否则内核在跑就不动它, 只让长连接按新配置重连
    fun reload(fresh: Boolean) = handler.post {
        handler.removeCallbacks(idleStop)
        val config = ConfigStore.load(context)
        if (config == null || !config.proxyEnabled) {
            core.stop()
            return@post onChanged()
        }
        if (fresh) {
            Subscription.download(context, config.subscription)
            core.stop()
        }
        // bringUp 在常驻模式下自己会通知长连接, 不重复通知
        if (resident(config) && !core.running && bringUp()) return@post
        if (!resident(config)) demandNow()
        onChanged()
    }

    /** 任何需要代理的请求之前调用 (经 ACTION_PROXY_DEMAND 跨进程转来), 顺带续租空闲计时。 */
    fun demand() = handler.post { demandNow() }

    // 连接失败等场景调用, 有防抖; 内核没在跑就没有可测的
    fun optimizeSoon() = handler.post {
        if (!core.running) return@post
        if (SystemClock.elapsedRealtime() - lastRun >= Constants.PROXY_OPTIMIZE_DEBOUNCE_MS) optimizeNow()
    }

    fun stop() {
        handler.removeCallbacksAndMessages(null)
        handler.post { core.stop() }
        thread.quitSafely()
    }

    private fun demandNow() {
        val config = ConfigStore.load(context)
        if (config == null || !config.proxyEnabled) return
        if (!core.running) {
            bringUp()
        } else if (SystemClock.elapsedRealtime() - lastRun > Constants.PROXY_OPTIMIZE_MAX_AGE_MS) {
            optimizeNow()
        }
        scheduleIdle(config)
    }

    private fun bringUp(): Boolean {
        val config = ConfigStore.load(context) ?: return false
        if (!config.proxyEnabled) return false
        if (!Subscription.file(context).exists()) Subscription.download(context, config.subscription)
        // 没有订阅就没有节点, 起内核只会让走代理的请求全部超时, 不如直接让调用方直连
        if (!Subscription.file(context).exists()) {
            LinkLog.add(context, "订阅不可用, 不启动代理内核")
            return false
        }
        if (!core.start(config)) {
            LinkLog.add(context, "代理内核启动失败: " + ProxyCore.recentErrors(context, 1).joinToString())
            return false
        }
        LinkStats.hit(LinkStats.Key.CORE_START)
        LinkLog.add(context, if (resident(config)) "代理内核启动 (长连接走代理, 常驻)" else "代理内核按需启动")
        // 内核记住了上次选的节点, 先让长连接连上, 再测速优选
        if (resident(config)) onChanged()
        optimizeNow()
        return true
    }

    private fun scheduleIdle(config: AppConfig) {
        handler.removeCallbacks(idleStop)
        if (!resident(config)) handler.postDelayed(idleStop, Constants.PROXY_IDLE_STOP_MS)
    }

    private fun stopIfIdle() {
        val config = ConfigStore.load(context)
        if (resident(config) || !core.running) return
        if (ProxyController(context).activeConnections() > 0) {
            config?.let(::scheduleIdle)
            return
        }
        core.stop()
        LinkStats.hit(LinkStats.Key.CORE_STOP)
        LinkLog.add(context, "代理内核空闲, 已停止")
    }

    private fun resident(config: AppConfig?): Boolean = config != null && config.proxyEnabled && config.proxyLink

    private fun optimizeNow() {
        lastRun = SystemClock.elapsedRealtime()
        LinkStats.hit(LinkStats.Key.OPTIMIZE)
        NodeOptimizer.run(context)
    }

    private companion object {
        const val THREAD_NAME = "node-picker"
    }
}
