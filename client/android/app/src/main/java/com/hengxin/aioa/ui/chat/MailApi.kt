package com.hengxin.aioa.ui.chat

import android.content.Context
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** 邮件群里的一封信 (服务端事件 + data.mail)。 */
data class MailItem(
    val seq: Long,
    val ts: Long,
    val subject: String,
    val summary: String,
    val html: String?,
    val from: String,
    val name: String?,
    val account: String,
    val vendor: String,
    val code: String?,
)

/** 筛选项: 厂商或账号, 封数与最新一封的时间。 */
data class MailFacet(val key: String, val count: Int, val last: Long)

data class MailPage(val items: List<MailItem>, val more: Boolean)

/** 邮件接口: 列表按时间倒序, 可按厂商 / 账号过滤; 统计给分组用。 */
class MailApi(private val context: Context) {

    suspend fun list(vendor: String?, account: String?, before: Long?): Result<MailPage> = io {
        val q = buildMap {
            vendor?.let { put("vendor", it) }
            account?.let { put("account", it) }
            before?.let { put("before", it.toString()) }
        }
        val r = Api.call(context, GET, listOf(PATH), query = q)
        val b = r.body ?: error(r.error ?: FAILED)
        val arr = b.optJSONArray("messages") ?: JSONArray()
        MailPage((0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(::item) }, b.optBoolean("more"))
    }

    suspend fun facets(): Result<Pair<List<MailFacet>, List<MailFacet>>> = io {
        val r = Api.call(context, GET, listOf(PATH, "facets"))
        val b = r.body ?: error(r.error ?: FAILED)
        facets(b.optJSONArray("vendors")) to facets(b.optJSONArray("accounts"))
    }

    private fun facets(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { i ->
        a?.optJSONObject(i)?.let { MailFacet(it.optString("key"), it.optInt("count"), it.optLong("last")) }
    }

    private fun item(o: JSONObject): MailItem? {
        val data = o.optJSONObject("data") ?: return null
        val m = data.optJSONObject("mail") ?: return null
        fun JSONObject.s(k: String) = optString(k).ifEmpty { null }
        return MailItem(
            seq = o.optLong("seq"),
            ts = o.optLong("ts"),
            subject = data.optString("title"),
            summary = data.optString("summary"),
            html = data.s("html"),
            from = m.optString("from"),
            name = m.s("name"),
            account = m.optString("to"),
            vendor = m.optString("vendor"),
            code = m.s("code"),
        )
    }

    private suspend fun <T> io(block: () -> T): Result<T> = withContext(Dispatchers.IO) { runCatching(block) }

    companion object {
        private const val PATH = "api/v1/mail"
        private const val GET = "GET"
        private const val FAILED = "加载失败"
    }
}
