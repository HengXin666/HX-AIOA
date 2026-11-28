package com.hengxin.aioa.browser

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage

/** 退出网站: 把 Cookie 置过期并清本地存储。要在主线程调用 (WebStorage 的要求)。 */
object SiteSession {
    private val SCHEMES = listOf("https", "http")

    fun logout(context: Context, record: SiteRecord) {
        val cm = CookieManager.getInstance()
        for (host in record.hosts + record.site) {
            val chain = SiteRules.domainChain(host, record.site)
            for (scheme in SCHEMES) {
                val url = "$scheme://$host/"
                val names = SiteRules.parse(cm.getCookie(url)).map { it.first }.distinct()
                for (name in names) SiteRules.expireLines(name, chain, scheme == SCHEMES[0]).forEach { cm.setCookie(url, it) }
                WebStorage.getInstance().deleteOrigin("$scheme://$host")
            }
        }
        cm.flush()
        SiteStore.markLoggedOut(context, setOf(record.site))
    }

    /** 全部退出: 清掉所有 Cookie 与网页存储, 不只是有记录的站点。 */
    fun logoutAll(context: Context, done: () -> Unit) {
        WebStorage.getInstance().deleteAllData()
        CookieManager.getInstance().removeAllCookies {
            CookieManager.getInstance().flush()
            SiteStore.markLoggedOut(context, null)
            done()
        }
    }
}
