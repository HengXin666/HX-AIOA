package com.hengxin.aioa.browser

import okhttp3.HttpUrl

/** 站点记录用的纯规则: 域名归并, 是否像登录态, 退出时要置过期的 Cookie。不依赖 Android, 便于单测。 */
object SiteRules {
    private const val EXPIRED = "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"
    private const val WWW = "www."

    // Cookie 名里出现这些词就算像登录态; csrf / xsrf 令牌只防伪造, 不代表登录
    private val LOGIN_WORDS = listOf("session", "sess", "token", "auth", "login", "logged", "sid", "jwt", "passport", "account")
    private val NOT_LOGIN_WORDS = listOf("csrf", "xsrf", "_ga", "_gid", "consent", "locale", "lang", "theme")
    // 常见站点的登录 Cookie 名不含上面的词, 单独列出 (百度, 微博, QQ, Google)
    private val LOGIN_NAMES = setOf("bduss", "sub", "uin", "p_uin", "skey", "p_skey", "sapisid", "ssid", "hsid", "uid", "user_id", "userid")
    private val FALSY = setOf("", "no", "false", "0", "deleted", "null")

    // 退出某站后提示: 这些站点常被代理订阅或集成登录用到
    private val SHARED_SITES = setOf("cloudflare.com", "cloudflareaccess.com", "github.com")

    /** 可注册域名 (eTLD+1), 用 OkHttp 自带的公共后缀表; IP, localhost 等取不到时退回主机本身。 */
    fun siteOf(host: String): String {
        val h = host.trim().lowercase().trimEnd('.')
        if (h.isEmpty()) return h
        val url = HttpUrl.Builder().scheme("https").host(h).build()
        return url.topPrivateDomain() ?: h
    }

    /** 主机显示名: 去掉 www.。 */
    fun display(host: String): String = host.lowercase().removePrefix(WWW)

    /** 解析 CookieManager.getCookie 返回的 "a=1; b=2"。 */
    fun parse(header: String?): List<Pair<String, String>> =
        header.orEmpty().split(';').mapNotNull { part ->
            val p = part.trim()
            if (p.isEmpty()) return@mapNotNull null
            val eq = p.indexOf('=')
            if (eq < 0) p to "" else p.substring(0, eq).trim() to p.substring(eq + 1).trim()
        }

    fun looksLoggedIn(cookies: List<Pair<String, String>>): Boolean = cookies.any { (name, value) -> isLoginCookie(name, value) }

    fun isLoginCookie(name: String, value: String): Boolean {
        val n = name.lowercase().removePrefix("__host-").removePrefix("__secure-")
        if (value.trim().lowercase() in FALSY) return false
        if (n in LOGIN_NAMES) return true
        if (NOT_LOGIN_WORDS.any { n.contains(it) }) return false
        return LOGIN_WORDS.any { n.contains(it) }
    }

    /** 从主机到可注册域名的每一级: a.b.example.com -> a.b.example.com, b.example.com, example.com。 */
    fun domainChain(host: String, site: String): List<String> {
        val h = host.lowercase()
        if (site.isEmpty() || !(h == site || h.endsWith(".$site"))) return listOf(h)
        val out = mutableListOf<String>()
        var cur = h
        while (true) {
            out += cur
            if (cur == site) break
            cur = cur.substringAfter('.')
        }
        return out
    }

    /** 让一个 Cookie 过期要写的 Set-Cookie 串: 不带 Domain (仅主机) 一条, 每一级父域各一条。 */
    fun expireLines(name: String, chain: List<String>, secure: Boolean): List<String> {
        val tail = if (secure) "; Secure" else ""
        val hostOnly = "$name=; $EXPIRED$tail"
        if (name.startsWith("__Host-")) return listOf(hostOnly)
        return listOf(hostOnly) + chain.map { "$name=; $EXPIRED; Domain=.$it$tail" }
    }

    fun isShared(site: String): Boolean = site in SHARED_SITES

    /** 列表分组: 当前站点置顶, 其余分 已登录 / 访问过, 各按最近访问倒序; query 按域名与标题过滤。 */
    fun arrange(records: List<SiteRecord>, current: String?, query: String): SiteGroups {
        val q = query.trim().lowercase()
        val hit = records
            .filter { q.isEmpty() || it.site.contains(q) || it.hosts.any { h -> h.contains(q) } || it.title.lowercase().contains(q) }
            .sortedByDescending { it.last }
        val pinned = hit.filter { it.site == current }
        val rest = hit - pinned.toSet()
        return SiteGroups(pinned, rest.filter { it.login }, rest.filterNot { it.login })
    }

    /** 最近访问的相对时间。 */
    fun ago(at: Long, now: Long): String {
        val d = (now - at).coerceAtLeast(0)
        return when {
            d < MINUTE -> "刚刚"
            d < HOUR -> "${d / MINUTE} 分钟前"
            d < DAY -> "${d / HOUR} 小时前"
            d < MONTH -> "${d / DAY} 天前"
            else -> "${d / MONTH} 个月前"
        }
    }

    private const val MINUTE = 60_000L
    private const val HOUR = 60 * MINUTE
    private const val DAY = 24 * HOUR
    private const val MONTH = 30 * DAY
}

data class SiteGroups(val current: List<SiteRecord>, val login: List<SiteRecord>, val visited: List<SiteRecord>)
