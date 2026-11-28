package com.hengxin.aioa.browser

import android.content.Context
import android.graphics.Bitmap
import com.hengxin.aioa.config.JsonFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** 一个可注册域名 (eTLD+1) 下的访问记录。 */
data class SiteRecord(
    val site: String,
    val host: String,
    val hosts: Set<String>,
    val title: String,
    val first: Long,
    val last: Long,
    val cookies: Int,
    val login: Boolean,
)

/**
 * 内置浏览器打开过的网站, 只存本机文件, 不上传。
 * CookieManager 不能列出全部域名, 所以每次页面加载完自己记一条。
 */
object SiteStore {
    private const val FILE = "browser-sites.json"
    private const val ICON_DIR = "browser-icons"
    private const val KEY_SITES = "sites"
    private const val KEY_DARK = "forceDark"
    private const val KEY_SITE = "site"
    private const val KEY_HOST = "host"
    private const val KEY_HOSTS = "hosts"
    private const val KEY_TITLE = "title"
    private const val KEY_FIRST = "first"
    private const val KEY_LAST = "last"
    private const val KEY_COOKIES = "cookies"
    private const val KEY_LOGIN = "login"
    private const val ICON_PX = 64
    private const val ICON_QUALITY = 100

    private val lock = Any()
    // 内存副本: 每次导航都要查强制深色, 不想每次读文件
    private var cache: Pair<Map<String, SiteRecord>, Set<String>>? = null

    fun list(context: Context): List<SiteRecord> = synchronized(lock) { read(context).first.values.sortedByDescending { it.last } }

    /** 页面加载完时调用; 没有 Cookie 且之前没记过就不记。 */
    fun record(context: Context, host: String, title: String, cookieHeader: String?, now: Long = System.currentTimeMillis()) {
        if (host.isEmpty()) return
        val cookies = SiteRules.parse(cookieHeader)
        val site = SiteRules.siteOf(host)
        synchronized(lock) {
            val (sites, dark) = read(context)
            val old = sites[site]
            if (old == null && cookies.isEmpty()) return
            sites[site] = SiteRecord(
                site = site,
                host = host.lowercase(),
                hosts = (old?.hosts.orEmpty() + host.lowercase()),
                title = title.ifBlank { old?.title.orEmpty() },
                first = old?.first ?: now,
                last = now,
                cookies = cookies.size,
                login = SiteRules.looksLoggedIn(cookies),
            )
            write(context, sites, dark)
        }
    }

    fun saveIcon(context: Context, host: String, icon: Bitmap) {
        val file = iconFile(context, SiteRules.siteOf(host))
        runCatching {
            file.parentFile?.mkdirs()
            val scaled = if (icon.width > ICON_PX) Bitmap.createScaledBitmap(icon, ICON_PX, ICON_PX, true) else icon
            file.outputStream().use { scaled.compress(Bitmap.CompressFormat.PNG, ICON_QUALITY, it) }
        }
    }

    fun iconFile(context: Context, site: String) = File(File(context.filesDir, ICON_DIR), "$site.png")

    fun forget(context: Context, site: String) = synchronized(lock) {
        val (sites, dark) = read(context)
        sites.remove(site)
        iconFile(context, site).delete()
        write(context, sites, dark)
    }

    /** 退出后 Cookie 没了, 记录留着但标成未登录。 */
    fun markLoggedOut(context: Context, sites: Set<String>?) = synchronized(lock) {
        val (all, dark) = read(context)
        for ((k, v) in all) if (sites == null || k in sites) all[k] = v.copy(cookies = 0, login = false)
        write(context, all, dark)
    }

    fun forceDark(context: Context, host: String): Boolean = synchronized(lock) { SiteRules.siteOf(host) in read(context).second }

    fun setForceDark(context: Context, host: String, on: Boolean) = synchronized(lock) {
        val (sites, dark) = read(context)
        val site = SiteRules.siteOf(host)
        write(context, sites, if (on) dark + site else dark - site)
    }

    private fun file(context: Context) = File(context.filesDir, FILE)

    private fun read(context: Context): Pair<MutableMap<String, SiteRecord>, Set<String>> {
        val hit = cache ?: load(context).also { cache = it }
        return hit.first.toMutableMap() to hit.second
    }

    private fun load(context: Context): Pair<Map<String, SiteRecord>, Set<String>> {
        val o = JsonFile.read(file(context)) ?: return emptyMap<String, SiteRecord>() to emptySet()
        val sites = mutableMapOf<String, SiteRecord>()
        val arr = o.optJSONArray(KEY_SITES) ?: JSONArray()
        for (i in 0 until arr.length()) {
            val r = arr.optJSONObject(i)?.let(::decode) ?: continue
            sites[r.site] = r
        }
        return sites to strings(o.optJSONArray(KEY_DARK)).toSet()
    }

    private fun write(context: Context, sites: Map<String, SiteRecord>, dark: Set<String>) {
        cache = sites.toMap() to dark
        val arr = JSONArray()
        sites.values.forEach { arr.put(encode(it)) }
        JsonFile.write(file(context), JSONObject().put(KEY_SITES, arr).put(KEY_DARK, JSONArray(dark.toList())))
    }

    private fun encode(r: SiteRecord) = JSONObject()
        .put(KEY_SITE, r.site).put(KEY_HOST, r.host).put(KEY_HOSTS, JSONArray(r.hosts.toList()))
        .put(KEY_TITLE, r.title).put(KEY_FIRST, r.first).put(KEY_LAST, r.last)
        .put(KEY_COOKIES, r.cookies).put(KEY_LOGIN, r.login)

    private fun decode(o: JSONObject): SiteRecord? {
        val site = o.optString(KEY_SITE).ifEmpty { return null }
        val host = o.optString(KEY_HOST).ifEmpty { site }
        return SiteRecord(
            site = site,
            host = host,
            hosts = strings(o.optJSONArray(KEY_HOSTS)).toSet() + host,
            title = o.optString(KEY_TITLE),
            first = o.optLong(KEY_FIRST),
            last = o.optLong(KEY_LAST),
            cookies = o.optInt(KEY_COOKIES),
            login = o.optBoolean(KEY_LOGIN),
        )
    }

    private fun strings(arr: JSONArray?): List<String> = arr?.let { a -> (0 until a.length()).map { a.optString(it) }.filter { it.isNotEmpty() } }.orEmpty()
}
