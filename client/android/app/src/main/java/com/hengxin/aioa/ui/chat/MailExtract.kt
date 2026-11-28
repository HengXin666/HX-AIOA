package com.hengxin.aioa.ui.chat

// 邮件关键信息 (#146), 移植自 protocol/src/v1/mail-extract.ts: 验证码与有效期, 关键链接, 类型与要点。

data class MailOtp(val code: String, val expiresAt: Long? = null)
data class MailLink(val label: String, val url: String)
data class MailFact(val label: String, val value: String)

/** 一封信的精简结果; kind 见 MailExtract.KIND_*。 */
data class MailDigest(
    val body: String,
    val brief: String,
    val kind: String,
    val otp: MailOtp? = null,
    val links: List<MailLink> = emptyList(),
    val facts: List<MailFact> = emptyList(),
)

object MailExtract {
    const val KIND_OTP = "otp"
    const val KIND_BILL = "bill"
    const val KIND_SHIPPING = "shipping"
    const val KIND_GITHUB = "github"
    const val KIND_MARKETING = "marketing"
    const val KIND_NORMAL = "normal"
    private const val MAX_BODY = 20_000
    private const val MAX_BRIEF = 120
    private const val MAX_LINKS = 3
    private const val MAX_LABEL = 40
    private const val HAY_MAX = 4000
    private const val NEAR_AFTER = 60
    private const val NEAR_BEFORE = 30
    private const val BRIEF_ENOUGH = 30
    private const val MIN_LINE = 4
    private const val MINUTE_MS = 60_000L
    private const val HOUR_MS = 3_600_000L
    private const val SEP = " · "
    private val IC = RegexOption.IGNORE_CASE

    private val OTP_STRONG = Regex(
        "(验证码|校验码|动态码|动态密码|确认码|安全码|登录码|激活码|一次性(?:密码|验证码|代码)|verification code|security code|confirmation code|" +
            "log[- ]?in code|sign[- ]?in code|access code|one[- ]time (?:pass)?code|one[- ]time password|\\botp\\b|\\bpasscode\\b|\\b2fa code\\b)",
        IC,
    )
    private val OTP_WEAK = Regex("(\\b(?:your|the|this|following|enter|use)\\s+code\\b|\\bcode\\s*(?:is\\b|:|：))", IC)
    private val VERIFY_HINT = Regex("verif|sign[- ]?in|log[- ]?in|登录|验证|确认|confirm|authenticat|2fa|otp|security|安全|password|密码", IC)
    private val CODE_RE = Regex("(?<![\\w\\-/:.@#])(\\d{3}[ -]\\d{3}|[A-Z0-9]{4,8})(?![\\w\\-/:%@]|\\.\\d)")
    private val YEAR = Regex("^(19|20)\\d{2}$")
    private val DIGIT = Regex("\\d")
    private val AFTER_UNIT = Regex("^\\s*(元|块|%|usd|cny|rmb|美元|分钟|分|min|秒|小时|天|days?|hours?|minutes?|items?|项|条|个|次|人|积分|points?|行|字|kb|mb|gb)", IC)
    private val BEFORE_NOISE = Regex("([¥￥$€£]|usd|cny|rmb|金额|订单号?|单号|order|#|no\\.|tel|phone|电话|手机|版本|version|v)\\s*[:：#]?\\s*$", IC)
    private val BREAK = Regex("[,;!?，；！？]|[.。](?!\\s*\\n)")
    private val PURE = Regex("^\\d{4,8}$")
    private val ALNUM = Regex("^(?=.*[A-Z])[A-Z0-9]{6,8}$")
    private val EXPIRES = listOf(
        Regex("(\\d{1,3})\\s*(分钟|分|小时|min(?:ute)?s?|hours?|hrs?)\\s*(?:内|之内)?\\s*(?:有效|过期|失效)", IC),
        Regex("(?:有效期|有效时间)\\s*(?:为|是)?\\s*[:：]?\\s*(\\d{1,3})\\s*(分钟|分|小时)"),
        Regex("(?:valid|expires?|expiring|active)\\s*(?:for|in|within|after)?\\s*(?:the\\s+next\\s+)?(\\d{1,3})\\s*(min(?:ute)?s?|hours?|hrs?)", IC),
    )
    private val HOUR_UNIT = Regex("小时|hour|hr", IC)
    private val ACTION = Regex("(登录|登入|确认|验证|激活|重置|找回|接受邀请|sign[- ]?in|log[- ]?in|verify|confirm|activate|reset|magic link|accept invit)", IC)
    private val GREETING = Regex("^((hi|hello|hey|dear|greetings)\\b.{0,30}|(您好|你好|亲爱的|尊敬的).{0,20})[,，!！:：]?$", IC)
    private val GH_REPO = Regex("^\\s*(?:(?:re|fwd?)\\s*:\\s*)*\\[([\\w.-]+/[\\w.-]+)]", IC)
    private val BILL = Regex("(账单|收据|发票|付款成功|支付成功|扣款|消费提醒|已支付|receipt|invoice|payment (?:received|confirmation|successful)|order confirmation|you(?:'ve| have) been charged|billing statement)", IC)
    private val AMOUNT = Regex("(?:[¥￥$€£]|US\\$|HK\\$|USD|CNY|RMB)\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?\\s?(?:元|USD|CNY|RMB)", IC)
    private val TOTAL = Regex("(合计|总计|实付|应付|支付金额|金额|total|amount|paid|charged)", IC)
    private val SHIP_NO = Regex("(运单号|快递单号|物流单号|tracking (?:number|no\\.?|#|id))\\s*[:：#]?\\s*([A-Z0-9]{8,30})", IC)
    private val SHIP_STATUS = Regex("(已签收|派送中|运输中|已发货|已揽收|待取件|delivered|out for delivery|in transit|shipped|ready for pickup)", IC)
    private val ALERT = Regex("(故障|恢复|告警|报警|异常|安全|incident|outage|degraded|resolved|alert|security|failed|error)", IC)
    private val PROMO = Regex("(sale|% off|discount|deal|coupon|promo|优惠|促销|折扣|限时|特价|满减|black friday|cyber monday|newsletter|webinar|hackathon|beta|launch|new feature|新品|上新|活动)", IC)
    private val WS = Regex("\\s+")

    private fun plausible(hay: String, at: Int, code: String): Boolean {
        if (!DIGIT.containsMatchIn(code) || YEAR.matches(code)) return false
        val end = at + code.length
        if (AFTER_UNIT.containsMatchIn(hay.substring(end, minOf(hay.length, end + 6)))) return false
        return !BEFORE_NOISE.containsMatchIn(hay.substring(maxOf(0, at - 12), at))
    }

    private fun pick(hay: String, from: Int, to: Int, before: Boolean): String? {
        val near = hay.substring(from, minOf(hay.length, to))
        val hits = ArrayList<String>()
        for (m in CODE_RE.findAll(near)) {
            val at = m.range.first
            val gap = if (before) near.substring(m.range.last + 1) else near.substring(0, at)
            val code = m.groupValues[1]
            if (BREAK.containsMatchIn(gap) || !plausible(hay, from + at, code)) continue
            hits.add(code.replace(" ", "").replace("-", ""))
        }
        if (before) hits.reverse()
        return hits.firstOrNull { PURE.matches(it) } ?: hits.firstOrNull { ALNUM.matches(it) }
    }

    /** 只取 "验证码 / verification code" 附近的码: 优先纯数字, 再取含数字的大写串。 */
    fun extractCode(subject: String, text: String): String? {
        val hay = subject + "\n" + text.take(HAY_MAX)
        val hints = OTP_STRONG.findAll(hay).toMutableList()
        if (VERIFY_HINT.containsMatchIn(hay.take(subject.length + 300))) hints.addAll(OTP_WEAK.findAll(hay))
        for (h in hints) {
            val start = h.range.last + 1
            pick(hay, start, start + NEAR_AFTER, false)?.let { return it }
        }
        for (h in hints) {
            val end = h.range.first
            pick(hay, maxOf(0, end - NEAR_BEFORE), end, true)?.let { return it }
        }
        return null
    }

    /** 有效期 (毫秒): "10 分钟内有效", "valid for 15 minutes"。 */
    fun expiresIn(text: String): Long? {
        for (re in EXPIRES) {
            val m = re.find(text) ?: continue
            return m.groupValues[1].toLong() * if (HOUR_UNIT.containsMatchIn(m.groupValues[2])) HOUR_MS else MINUTE_MS
        }
        return null
    }

    private fun actionLinks(anchors: List<MailAnchor>): List<MailLink> {
        val out = ArrayList<MailLink>()
        for (a in anchors) {
            if (a.label.length > MAX_LABEL || !ACTION.containsMatchIn(a.label) || out.any { it.url == a.url }) continue
            out.add(MailLink(a.label, a.url))
            if (out.size >= MAX_LINKS) break
        }
        return out
    }

    private fun norm(s: String) = s.lowercase().replace(WS, "")

    /** 要点: 跳过问候语, 与主题重复的行, 太短的行; 第一段不够长就接上下一段。 */
    fun briefOf(body: String, subject: String): String {
        val subj = norm(subject)
        val parts = ArrayList<String>()
        for (l in body.split("\n")) {
            val n = norm(l)
            if (l.length < MIN_LINE || GREETING.matches(l) || (n.isNotEmpty() && subj.contains(n))) continue
            parts.add(l)
            if (parts.joinToString(SEP).length >= BRIEF_ENOUGH) break
        }
        val s = parts.joinToString(SEP)
        return if (s.length > MAX_BRIEF) s.take(MAX_BRIEF - 1) + "…" else s
    }

    private fun kindOf(subject: String, from: String, name: String?, body: String, otp: Boolean, unsub: Boolean, known: Boolean): Pair<String, List<MailFact>> {
        if (otp) return KIND_OTP to emptyList()
        val repo = GH_REPO.find(subject)?.groupValues?.get(1)
        if (MailAddr.site(from) == "github.com") return KIND_GITHUB to listOfNotNull(repo?.let { MailFact("仓库", it) })
        val hay = subject + "\n" + body.take(HAY_MAX)
        SHIP_NO.find(hay)?.let { no ->
            val st = SHIP_STATUS.find(hay)?.groupValues?.get(1)
            return KIND_SHIPPING to listOfNotNull(MailFact("单号", no.groupValues[2]), st?.let { MailFact("状态", it) })
        }
        if (BILL.containsMatchIn(hay)) {
            val t = TOTAL.find(hay)
            val amount = (t?.let { AMOUNT.find(hay.substring(it.range.first)) }) ?: AMOUNT.find(hay)
            if (amount != null) return KIND_BILL to listOf(MailFact("金额", amount.value.trim()), MailFact("商家", name?.trim()?.ifEmpty { null } ?: MailAddr.site(from)))
        }
        if (unsub && !ALERT.containsMatchIn(subject) && (PROMO.containsMatchIn(hay) || !known)) return KIND_MARKETING to emptyList()
        return KIND_NORMAL to emptyList()
    }

    /** 与服务端 digestMail 一致: 正文去噪, 验证码与有效期, 关键链接, 类型与要点; known: 发件方在厂商表里 (客户端没有那张表, 由调用方判断)。 */
    fun digest(subject: String, from: String, name: String?, html: String?, text: String?, ts: Long?, code: String? = null, known: Boolean = false): MailDigest {
        val t = MailClean.mailText(html, text)
        val body = t.text.take(MAX_BODY)
        val found = code?.trim()?.ifEmpty { null } ?: extractCode(subject, body)
        val otp = found?.let { c ->
            val ttl = expiresIn(subject + "\n" + body.take(HAY_MAX))
            MailOtp(c, if (ttl != null && ts != null && ts > 0) ts + ttl else null)
        }
        val (kind, facts) = kindOf(subject, from, name, body, otp != null, t.unsub, known)
        return MailDigest(body, if (otp != null) "" else briefOf(body, subject), kind, otp, actionLinks(t.anchors), facts)
    }
}
