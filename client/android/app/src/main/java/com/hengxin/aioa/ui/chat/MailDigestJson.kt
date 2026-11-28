package com.hengxin.aioa.ui.chat

import org.json.JSONArray
import org.json.JSONObject

// 经由 HX-Email 推送时验证码是对方认出来的, 老信也可以信它
private const val VIA_HX_EMAIL = "hx-email"
private const val VENDOR_LABELS = 2

private fun JSONArray?.objects(): List<JSONObject> = (0 until (this?.length() ?: 0)).mapNotNull { this?.optJSONObject(it) }

/**
 * data.mail 里服务端收信时提取的结果 (#146); 老信没有 kind, 按同一套规则从摘要兜底
 * (老信的 code 可能是 GitHub 通知里的数字之类的误判, 不再沿用)。
 */
fun mailDigestOf(m: JSONObject, subject: String, summary: String, ts: Long): MailDigest {
    if (m.has("kind")) {
        val otp = m.optJSONObject("otp")?.let { o -> o.optString("code").ifEmpty { null }?.let { MailOtp(it, o.optLong("expiresAt").takeIf { e -> e > 0 }) } }
        return MailDigest(
            body = summary,
            brief = m.optString("brief"),
            kind = m.optString("kind"),
            otp = otp ?: m.optString("code").ifEmpty { null }?.let { MailOtp(it) },
            links = m.optJSONArray("links").objects().map { MailLink(it.optString("label"), it.optString("url")) },
            facts = m.optJSONArray("facts").objects().map { MailFact(it.optString("label"), it.optString("value")) },
        )
    }
    val from = m.optString("from")
    val code = m.optString("code").ifEmpty { null }?.takeIf { m.optString("via") == VIA_HX_EMAIL }
    // 服务端认识的厂商给名字, 不认识的给域名末两段
    val known = m.optString("vendor") != MailAddr.domain(from).split('.').takeLast(VENDOR_LABELS).joinToString(".")
    return MailExtract.digest(subject, from, m.optString("name").ifEmpty { null }, null, summary, ts, code, known)
}
