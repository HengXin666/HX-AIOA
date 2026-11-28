package com.hengxin.aioa.ui.chat

import android.content.Context
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.ApiCache
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
    // 收件账号; 空串 = 未知收件人 (旧信只存了中转地址)
    val account: String,
    // 信头 To 里的中转地址, 显示为 "经 ..."; CF 实际投递的地址
    val list: String?,
    val rcpt: String?,
    val via: String,
    val vendor: String,
    val category: String?,
    val code: String?,
    // 发件域名校验失败, 可能是冒充
    val spoof: Boolean,
    // 精简结果 (#146): 类型, 验证码与有效期, 要点, 关键链接与信息
    val digest: MailDigest = MailDigest(summary, "", MailExtract.KIND_NORMAL),
) {
    /** 列表与总览显示的一两行: 要点, 没有就用摘要。 */
    val preview get() = digest.brief.ifEmpty { summary }
}

/** 筛选项: 厂商或账号, 封数与最新一封的时间。 */
data class MailFacet(val key: String, val count: Int, val last: Long, val from: String? = null)

data class MailPage(val items: List<MailItem>, val more: Boolean)

/** 三种分组的统计。 */
data class MailFacets(val categories: List<MailFacet>, val vendors: List<MailFacet>, val accounts: List<MailFacet>)

/** 列表筛选条件, 都是可选的。 */
data class MailFilter(val category: String? = null, val vendor: String? = null, val account: String? = null) {
    val active get() = category != null || vendor != null || account != null
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

    suspend fun prefs(): Result<MailPrefs> = io {
        val r = Api.call(context, GET, listOf(PATH, "prefs"))
        MailPrefs.parse(r.body ?: error(r.error ?: FAILED))
    }

    /** 保存偏好, 白名单沿用旧的 (服务端不收)。 */
    suspend fun savePrefs(p: MailPrefs): Result<MailPrefs> = io {
        val r = Api.call(context, PUT, listOf(PATH, "prefs"), p.json())
        MailPrefs.parse(r.body ?: error(r.error ?: FAILED)).copy(known = p.known)
    }

    suspend fun rules(): Result<List<MailRule>> = io {
        val r = Api.call(context, GET, listOf(PATH, "rules"))
        MailRule.list((r.body ?: error(r.error ?: FAILED)).optJSONArray("rules"))
    }

    suspend fun saveRules(list: List<MailRule>): Result<List<MailRule>> = io {
        val body = JSONObject().put("rules", JSONArray().apply { list.forEach { put(it.json()) } })
        val r = Api.call(context, PUT, listOf(PATH, "rules"), body)
        MailRule.list((r.body ?: error(r.error ?: FAILED)).optJSONArray("rules"))
    }

    /** 以主人的名义把信转进群, 群里的 Agent 会被叫醒。 */
    suspend fun forward(id: String, channel: String): Result<Unit> = io {
        val r = Api.call(context, POST, listOf(PATH, id, "forward"), JSONObject().put("channel", channel))
        r.body ?: error(r.error ?: FAILED)
        Unit
    }

    /**
     * 群列表 (转发时选群), 带 Agent (#139): 先用群目录里已有的 (长连接实时更新), 再退到磁盘缓存,
     * 都没有才请求一次; 不再每次整表重拉 /chats。
     */
    suspend fun chats(): Result<List<ChatMeta>> = io {
        val known = ChatDirectories.current?.metas?.takeIf { it.isNotEmpty() }
            ?: ApiCache.read(context, CHATS_CACHE)?.let(::parseChats)?.takeIf { it.isNotEmpty() }
            ?: Api.call(context, GET, listOf(CHATS_PATH)).let { r -> parseChats(r.body ?: error(r.error ?: FAILED)) }
        known.values.filter { it.deleted == 0L && !it.isMail }.sortedByDescending { it.updated }
    }

    /** 删掉一封信 (群里的消息一起删)。 */
    suspend fun remove(seq: Long): Result<Unit> = io { ChatHistory(context).remove(seq, DELETE_MODE).getOrThrow(); Unit }

    private fun facets(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { i ->
        a?.optJSONObject(i)?.let { MailFacet(it.optString("key"), it.optInt("count"), it.optLong("last"), it.optString("from").ifEmpty { null }) }
    }

    /** 事件 JSON (id, seq, ts, data.mail) 转成一封信; 总览里点开单封信也用它。 */
    fun item(o: JSONObject): MailItem? {
        val data = o.optJSONObject("data") ?: return null
        val m = data.optJSONObject("mail") ?: return null
        fun JSONObject.s(k: String) = optString(k).ifEmpty { null }
        val to = m.optString("to")
        // 旧信把中转地址当了账号: 归为未知, 中转地址挪到 list
        val relay = MailAddr.isRelay(to)
        val subject = data.optString("title")
        val summary = data.optString("summary")
        val ts = o.optLong("ts")
        val digest = mailDigestOf(m, subject, summary, ts)
        return MailItem(
            id = o.optString("id"),
            seq = o.optLong("seq"),
            ts = ts,
            subject = subject,
            summary = summary,
            body = m.s("body"),
            from = m.optString("from"),
            name = m.s("name"),
            account = if (relay) "" else to,
            list = m.s("list") ?: to.takeIf { relay },
            rcpt = m.s("rcpt"),
            via = m.optString("via"),
            vendor = m.optString("vendor"),
            category = m.s("category"),
            code = digest.otp?.code,
            spoof = m.optBoolean("spoof"),
            digest = digest,
        )
    }

    private suspend fun <T> io(block: () -> T): Result<T> = withContext(Dispatchers.IO) { runCatching(block) }

    companion object {
        private const val PATH = "api/v1/mail"
        private const val GET = "GET"
        private const val PUT = "PUT"
        private const val POST = "POST"
        private const val FAILED = "加载失败"
        private const val DELETE_MODE = "delete"
        // 与 ChatDirectory 同一份群列表缓存
        private const val CHATS_PATH = "api/v1/chats"
        private const val CHATS_CACHE = "chats"
    }
}

/** 地址工具, 与 protocol 的 isRelayAddress / siteOf 一致。 */
object MailAddr {
    private val RELAY_LOCAL = Regex("^(no-?reply|do-?not-?reply|notifications?|reply(\\+.*)?|bounces?)$")
    private val RELAY_DOMAIN = Regex("(^|\\.)(noreply|no-reply|reply|bounces?)\\.")
    private val SECOND_LEVEL = setOf("com", "net", "org", "gov", "edu", "ac", "co")

    fun domain(addr: String): String = addr.substringAfterLast('@').trim().lowercase()

    fun isRelay(addr: String): Boolean {
        val a = addr.trim().lowercase()
        if ('@' !in a) return false
        return RELAY_LOCAL.matches(a.substringBeforeLast('@')) || RELAY_DOMAIN.containsMatchIn(domain(a) + ".")
    }

    /** 主域名: a.b.example.com -> example.com; x.com.cn 保留三段。 */
    fun site(addr: String): String {
        val p = domain(addr).split('.').filter { it.isNotEmpty() }
        if (p.size <= 2) return p.joinToString(".")
        val n = if (p.last().length == 2 && p[p.size - 2] in SECOND_LEVEL) 3 else 2
        return p.takeLast(n).joinToString(".")
    }
}
