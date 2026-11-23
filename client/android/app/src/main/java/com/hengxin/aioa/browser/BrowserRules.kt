package com.hengxin.aioa.browser

import android.net.Uri
import android.util.Patterns
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

// 迷你浏览器的规则: 地址栏输入解析, 广告域名拦截
object BrowserRules {
    const val SEARCH_URL = "https://www.bing.com/search?q="
    private const val HTTPS = "https://"

    // 常见广告 / 统计域名, 命中自身或子域即拦截; 只拦第三方资源, 不影响页面本身
    private val AD_HOSTS = setOf(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
        "google-analytics.com", "googletagmanager.com", "amazon-adsystem.com", "adnxs.com",
        "taboola.com", "outbrain.com", "criteo.com", "criteo.net", "scorecardresearch.com", "2mdn.net",
        "pos.baidu.com", "cpro.baidu.com", "hm.baidu.com", "eclick.baidu.com", "cnzz.com", "mmstat.com",
        "tanx.com", "mediav.com", "gdt.qq.com", "pgdt.gtimg.cn", "l.qq.com", "adsame.com", "irs01.com",
        "miaozhen.com", "admaster.com.cn", "umeng.com", "pangolin-sdk-toutiao.com", "union.baidu.com",
    )

    /** 地址栏输入: 像网址就补全协议打开, 否则当搜索词。 */
    fun resolve(input: String): String {
        val text = input.trim()
        val uri = runCatching { Uri.parse(text) }.getOrNull()
        if (uri?.scheme != null && text.contains("://")) return text
        if (!text.contains(' ') && Patterns.WEB_URL.matcher(text).matches()) return HTTPS + text
        return SEARCH_URL + Uri.encode(text)
    }

    fun blocked(host: String?, pageHost: String?): Boolean {
        val h = host?.lowercase() ?: return false
        if (pageHost != null && sameSite(h, pageHost.lowercase())) return false
        var cur = h
        while (true) {
            if (cur in AD_HOSTS) return true
            val dot = cur.indexOf('.')
            if (dot < 0) return false
            cur = cur.substring(dot + 1)
        }
    }

    fun empty(): WebResourceResponse = WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))

    // 页面自己的站点 (比如直接打开了 baidu 的统计后台) 不拦
    private fun sameSite(a: String, b: String) = a == b || a.endsWith(".$b") || b.endsWith(".$a")
}
