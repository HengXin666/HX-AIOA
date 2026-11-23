package com.hengxin.aioa.ui.chat

import android.content.Context
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** 邮件群里的一封信 (服务端事件 + data.mail)。 */
data class MailItem(
    val id: String,
    val seq: Long,
    val ts: Long,
    val subject: String,
    val summary: String,
    // 有完整正文可取: html 原版网页, text 长文本
    val body: String?,
    val from: String,
    val name: String?,
    val account: String,
    val vendor: String,
    val code: String?,
    // 发件域名校验失败, 可能是冒充
    val spoof: Boolean,
)

/** 筛选项: 厂商或账号, 封数与最新一封的时间。 */
data class MailFacet(val key: String, val count: Int, val last: Long)

data class MailPage(val items: List<MailItem>, val more: Boolean)

/** 三种分组的统计。 */
data class MailFacets(val categories: List<MailFacet>, val vendors: List<MailFacet>, val accounts: List<MailFacet>)

/** 列表筛选条件, 都是可选的。 */
data class MailFilter(val category: String? = null, val vendor: String? = null, val account: String? = null) {
    val active get() = category != null || vendor != null || account != null
    val label get() = category ?: vendor ?: account
}

/** 邮件接口: 列表按时间倒序, 可按厂商 / 账号过滤; 统计给分组用。 */
class MailApi(private val context: Context) {

    suspend fun list(f: MailFilter, search: String?, before: Long?): Result<MailPage> = io {
        val q = buildMap {
            f.category?.let { put("category", it) }
            f.vendor?.let { put("vendor", it) }
            f.account?.let { put("account", it) }
            search?.let { put("q", it) }
            before?.let { put("before", it.toString()) }
        }
        val r = Api.call(context, GET, listOf(PATH), query = q)
        val b = r.body ?: error(r.error ?: FAILED)
        val arr = b.optJSONArray("messages") ?: JSONArray()
        MailPage((0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(::item) }, b.optBoolean("more"))
    }

    suspend fun facets(): Result<MailFacets> = io {
        val r = Api.call(context, GET, listOf(PATH, "facets"))
        val b = r.body ?: error(r.error ?: FAILED)
        MailFacets(facets(b.optJSONArray("categories")), facets(b.optJSONArray("vendors")), facets(b.optJSONArray("accounts")))
    }

    /** 完整正文, 服务端统一给 HTML。 */
    suspend fun body(id: String): Result<String> = io {
        val r = Api.call(context, GET, listOf(PATH, id, "body"))
        r.body?.optString("html")?.ifEmpty { null } ?: error(r.error ?: FAILED)
    }

    private fun facets(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { i ->
        a?.optJSONObject(i)?.let { MailFacet(it.optString("key"), it.optInt("count"), it.optLong("last")) }
    }

    private fun item(o: JSONObject): MailItem? {
        val data = o.optJSONObject("data") ?: return null
        val m = data.optJSONObject("mail") ?: return null
        fun JSONObject.s(k: String) = optString(k).ifEmpty { null }
        return MailItem(
            id = o.optString("id"),
            seq = o.optLong("seq"),
            ts = o.optLong("ts"),
            subject = data.optString("title"),
            summary = data.optString("summary"),
            body = m.s("body"),
            from = m.optString("from"),
            name = m.s("name"),
            account = m.optString("to"),
            vendor = m.optString("vendor"),
            code = m.s("code"),
            spoof = m.optBoolean("spoof"),
        )
    }

    private suspend fun <T> io(block: () -> T): Result<T> = withContext(Dispatchers.IO) { runCatching(block) }

    companion object {
        private const val PATH = "api/v1/mail"
        private const val GET = "GET"
        private const val FAILED = "加载失败"
    }
}
