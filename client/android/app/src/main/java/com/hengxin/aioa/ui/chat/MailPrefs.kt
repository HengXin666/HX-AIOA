package com.hengxin.aioa.ui.chat

import org.json.JSONArray
import org.json.JSONObject

// 邮件显示偏好与自动转发规则, 与 protocol 的 mail-rules.ts 对应; 存服务端, 各端共用

const val IMAGES_KNOWN = "known"
const val IMAGES_ALL = "all"
const val IMAGES_NONE = "none"
const val SHOW = "show"
const val BLOCK = "block"
const val STYLE_ADAPT = "adapt"
const val STYLE_ORIGINAL = "original"
const val STYLE_TEXT = "text"

val IMAGE_POLICY_LABEL = linkedMapOf(IMAGES_KNOWN to "只放行白名单", IMAGES_ALL to "全部显示", IMAGES_NONE to "全部拦截")
val STYLE_LABEL = linkedMapOf(STYLE_ADAPT to "深色适配", STYLE_ORIGINAL to "原样", STYLE_TEXT to "纯文本")

data class MailSenderPref(val images: String? = null, val style: String? = null) {
    val empty get() = images == null && style == null
}

/** images: 默认策略; senders: 键为小写地址或域名; known: 白名单域名 (服务端给, 只读)。 */
data class MailPrefs(
    val images: String = IMAGES_KNOWN,
    val senders: Map<String, MailSenderPref> = emptyMap(),
    val known: Set<String> = emptySet(),
) {
    /** 先找地址, 再从完整域名逐级往上找; 地址上的设置覆盖域名的。 */
    fun pref(from: String): MailSenderPref {
        val addr = from.trim().lowercase()
        val own = senders[addr]
        var d = MailAddr.domain(addr)
        while ('.' in d) {
            senders[d]?.let { return MailSenderPref(own?.images ?: it.images, own?.style ?: it.style) }
            d = d.substringAfter('.')
        }
        return own ?: MailSenderPref()
    }

    fun knownSender(from: String): Boolean {
        var d = MailAddr.domain(from)
        while ('.' in d) {
            if (d in known) return true
            d = d.substringAfter('.')
        }
        return false
    }

    /** 与服务端 imagesAllowed 一致: 发件人设置优先, 冒充的信只看明确放行, 再按默认策略。 */
    fun imagesAllowed(from: String, spoof: Boolean): Boolean {
        pref(from).images?.let { return it == SHOW }
        if (spoof) return false
        return images == IMAGES_ALL || (images == IMAGES_KNOWN && knownSender(from))
    }

    fun style(from: String): String = pref(from).style ?: STYLE_ADAPT

    /** 改一个发件人 (地址或域名) 的设置; 两项都空就删掉。 */
    fun withSender(key: String, p: MailSenderPref): MailPrefs =
        copy(senders = if (p.empty) senders - key else senders + (key.lowercase() to p))

    fun json(): JSONObject = JSONObject().put("images", images).put("senders", JSONObject().apply {
        senders.forEach { (k, v) -> put(k, JSONObject().apply { v.images?.let { put("images", it) }; v.style?.let { put("style", it) } }) }
    })

    companion object {
        fun parse(o: JSONObject): MailPrefs {
            val s = o.optJSONObject("senders")
            val senders = s?.keys()?.asSequence()?.associateWith { k ->
                val v = s.optJSONObject(k)
                MailSenderPref(v?.optString("images")?.ifEmpty { null }, v?.optString("style")?.ifEmpty { null })
            } ?: emptyMap()
            val k = o.optJSONArray("known")
            val known = (0 until (k?.length() ?: 0)).mapNotNull { k?.optString(it)?.ifEmpty { null } }.toSet()
            return MailPrefs(o.optString("images").ifEmpty { IMAGES_KNOWN }, senders, known)
        }
    }
}

/** 自动转发规则: 条件全满足才转; keep=false 转完从邮件列表删掉。 */
data class MailRule(
    val id: String = "",
    val on: Boolean = true,
    val from: String? = null,
    val domain: String? = null,
    val subject: String? = null,
    val channel: String,
    val keep: Boolean = true,
) {
    fun label(): String = listOfNotNull(from?.let { "发件人 $it" }, domain?.let { "域名 $it" }, subject?.let { "标题含 \"$it\"" }).joinToString(" 且 ")

    fun json(): JSONObject = JSONObject().put("on", on).put("channel", channel).put("keep", keep).apply {
        if (id.isNotEmpty()) put("id", id)
        from?.let { put("from", it) }
        domain?.let { put("domain", it) }
        subject?.let { put("subject", it) }
    }

    companion object {
        fun parse(o: JSONObject) = MailRule(
            id = o.optString("id"),
            on = o.optBoolean("on", true),
            from = o.optString("from").ifEmpty { null },
            domain = o.optString("domain").ifEmpty { null },
            subject = o.optString("subject").ifEmpty { null },
            channel = o.optString("channel"),
            keep = o.optBoolean("keep", true),
        )

        fun list(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { a?.optJSONObject(it)?.let(::parse) }
    }
}

/**
 * 链接的真实去向: 跟踪跳转常把目标放在 url / u / redirect 等参数里, 能取出来就去掉跟踪;
 * 取不出 (如 customer.io 的加密跳转) 就原样返回。
 */
fun unwrapLink(url: String): String {
    val uri = runCatching { android.net.Uri.parse(url) }.getOrNull() ?: return url
    if (uri.isOpaque) return url
    for (k in REDIRECT_KEYS) {
        val v = runCatching { uri.getQueryParameter(k) }.getOrNull() ?: continue
        if (v.startsWith("http://") || v.startsWith("https://")) return unwrapLink(v)
    }
    return url
}

private val REDIRECT_KEYS = listOf("url", "u", "redirect", "redirect_url", "redirect_uri", "target", "dest", "destination", "link", "to", "q")
