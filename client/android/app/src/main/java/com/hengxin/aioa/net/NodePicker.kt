package com.hengxin.aioa.net

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.ConfigStore

// 订阅下载与节点优选: 启动时, 每小时, 网络切换和连接断开时测一次全部节点延迟, 选最快的
// 选中结果由 mihomo 的 store-selected 落盘, 重启后直接沿用, 不必等测速
// onChanged 只在代理可用性变化时回调 (启动, 重载), 让长连接改走新路径
class NodePicker(private val context: Context, private val onChanged: () -> Unit) {

    private val thread = HandlerThread(THREAD_NAME).apply { start() }
    private val handler = Handler(thread.looper)
    private val core = ProxyCore(context)
    private var lastRun = 0L
    private val periodic = Runnable { refreshIfStale(); optimizeNow(); schedule() }

    fun start() = handler.post {
        val config = ConfigStore.load(context)
        if (config != null && config.proxyEnabled && Subscription.stale(context)) Subscription.download(context, config.subscription)
        if (config != null && core.start(config)) {
            optimizeNow()
            onChanged()
        }
        schedule()
    }

    fun reload() = handler.post {
        handler.removeCallbacks(periodic)
        core.stop()
        val config = ConfigStore.load(context)
        if (config != null && config.proxyEnabled) Subscription.download(context, config.subscription)
        if (config != null && core.start(config)) optimizeNow()
        onChanged()
        schedule()
    }

    // 连接失败等场景调用, 有防抖, 不会频繁测速
    fun optimizeSoon() = handler.post {
        if (SystemClock.elapsedRealtime() - lastRun >= Constants.PROXY_OPTIMIZE_DEBOUNCE_MS) optimizeNow()
    }

    fun stop() {
        handler.removeCallbacksAndMessages(null)
        handler.post { core.stop() }
        thread.quitSafely()
    }

    private fun schedule() {
        handler.removeCallbacks(periodic)
        handler.postDelayed(periodic, Constants.PROXY_OPTIMIZE_INTERVAL_MS)
    }

    // 订阅超过一天就重新下载, 内核在跑时可以借代理下载, 下载成功后让内核重读文件
    private fun refreshIfStale() {
        val config = ConfigStore.load(context) ?: return
        if (!config.proxyEnabled || !Subscription.stale(context)) return
        if (Subscription.download(context, config.subscription).ok) ProxyController(context).refreshSubscription()
    }

    private fun optimizeNow() {
        lastRun = SystemClock.elapsedRealtime()
        NodeOptimizer.run(context)
    }

    private companion object {
        const val THREAD_NAME = "node-picker"
    }
}
