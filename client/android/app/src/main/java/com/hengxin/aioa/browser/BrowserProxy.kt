package com.hengxin.aioa.browser

import android.content.Context
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.net.ProxyCore
import com.hengxin.aioa.net.ProxyDemand
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

// 浏览器走订阅代理: 整个进程的 WebView 统一设置, 先本机内核, 内核不通时 Chromium 自动退回直连
// 分流 (国内直连 / 国外走节点) 由订阅里的规则决定
object BrowserProxy {
    @Volatile var active = false
        private set

    fun wanted(context: Context): Boolean =
        ConfigStore.load(context)?.proxyEnabled == true && WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)

    /** 按需拉起内核并设好代理; 返回是否在用代理。 */
    suspend fun apply(context: Context): Boolean {
        val on = wanted(context) && withContext(Dispatchers.IO) { ProxyDemand.ensure(context.applicationContext) }
        if (on == active && on) return true
        if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) set(on)
        active = on
        return on
    }

    /** 内核空闲停掉后, 回到前台或开始新导航时续上; 不阻塞页面。 */
    suspend fun keepAlive(context: Context) {
        if (!active || withContext(Dispatchers.IO) { ProxyCore.listening() }) return
        withContext(Dispatchers.IO) { ProxyDemand.ensure(context.applicationContext) }
    }

    private suspend fun set(on: Boolean) = suspendCancellableCoroutine { cont ->
        val done = Runnable { if (cont.isActive) cont.resume(Unit) }
        val controller = ProxyController.getInstance()
        if (on) {
            val config = ProxyConfig.Builder()
                .addProxyRule("${Constants.LOOPBACK}:${Constants.PROXY_PORT}")
                .addDirect()
                .build()
            controller.setProxyOverride(config, Runnable::run, done)
        } else {
            controller.clearProxyOverride(Runnable::run, done)
        }
    }
}
