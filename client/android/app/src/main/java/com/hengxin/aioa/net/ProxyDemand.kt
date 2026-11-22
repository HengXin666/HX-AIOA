package com.hengxin.aioa.net

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.link.LinkService

// 按需使用代理的入口, 两个进程都可调用: 请 :link 拉起内核并续租空闲计时, 阻塞等端口可用; 不能在主线程调用
object ProxyDemand {
    private const val POLL_MS = 200L
    // 首次启动可能要先下载订阅, 比单纯等内核就绪多给一些时间
    private const val WAIT_FACTOR = 4

    fun ensure(context: Context): Boolean {
        val config = ConfigStore.load(context) ?: return false
        if (!config.proxyEnabled || !ProxyCore(context).available) return false
        val started = System.currentTimeMillis()
        LinkService.start(context, Constants.ACTION_PROXY_DEMAND)
        val deadline = System.currentTimeMillis() + Constants.PROXY_READY_TIMEOUT_MS * WAIT_FACTOR
        while (System.currentTimeMillis() < deadline) {
            if (ProxyCore.listening()) return true
            // 订阅这次已经下载失败且没有旧文件, 内核不会起来, 不必干等到超时
            val sub = Subscription.status(context)
            if (sub != null && !sub.ok && sub.at >= started && !Subscription.file(context).exists()) return false
            Thread.sleep(POLL_MS)
        }
        return ProxyCore.listening()
    }
}
