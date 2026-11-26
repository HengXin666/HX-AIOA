package com.hengxin.aioa.ui.agents

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

// 云 Agent 定时表达式的推算, 与 protocol/src/v1/trigger.ts 同一算法, 改一边要同步另一边
// cron 按 Agent 宿主时区算, 没上报时按本机时区; 间隔写法以 lastRun (没有则 at) 为基准

const val UPCOMING_MAX = 12
const val LATE_GRACE_MAX_MS = 30 * 60_000L
private const val TRIGGER_TZ_MAX = 64
private const val SEC_MS = 1000L
private const val CRON_FIELDS = 5
private const val SEARCH_STEPS = 200_000
private const val SEARCH_SPAN_DAYS = 8 * 366L
private const val COUNT_MAX = 1000
private const val STAR = "*"
private const val DAYS_SHOWN = 2L
private val UNIT = mapOf("s" to 1L, "m" to 60L, "h" to 3600L, "d" to 86_400L, "秒" to 1L, "分" to 60L, "分钟" to 60L, "时" to 3600L, "小时" to 3600L, "天" to 86_400L)
private val NUM = Regex("""^\d+$""")
private val EN = Regex("""^every\s+(\d+)\s*([smhd])[a-z]*$""", RegexOption.IGNORE_CASE)
private val ZH = Regex("""^每\s*(\d*)\s*(秒|分钟|分|小时|时|天)$""")
private val PART = Regex("""^(\*|(\d+)(?:-(\d+))?)(?:/(\d+))?$""")
private val SPACES = Regex("""\s+""")

data class CronSpec(val minute: Set<Int>, val hour: Set<Int>, val dom: Set<Int>, val month: Set<Int>, val dow: Set<Int>, val domStar: Boolean, val dowStar: Boolean)

sealed interface ParsedTrigger {
    data class Every(val every: Long) : ParsedTrigger
    data class Cron(val cron: CronSpec) : ParsedTrigger
}

/** 卡片与详情要的全部; upcoming 是今天和明天的触发点, 最多 12 个, 一个都没有时只放下一次。 */
data class TriggerView(val parsed: Boolean, val next: Long?, val upcoming: List<Long>, val expected: Long?, val late: Boolean, val zone: ZoneId)

private fun pos(n: Long?): Long? = n?.takeIf { it > 0 }

/** 非 cron 的间隔写法推算秒数: every 2h, 每 2 小时, 纯数字秒; 看不懂返回 null。 */
fun parseInterval(expr: String): Long? {
    val t = expr.trim()
    if (NUM.matches(t)) return pos(t.toLongOrNull())
    EN.find(t)?.let { m -> return pos(m.groupValues[1].toLongOrNull()?.times(UNIT[m.groupValues[2].lowercase()] ?: 0)) }
    ZH.find(t)?.let { m -> return pos((if (m.groupValues[1].isEmpty()) 1L else m.groupValues[1].toLongOrNull())?.times(UNIT[m.groupValues[2]] ?: 0)) }
    return null
}

// 一段: *, */n, a, a-b, a-b/n, 用逗号连成列表; 越界或写错返回 null
private fun field(src: String, lo: Int, hi: Int): Set<Int>? {
    val out = sortedSetOf<Int>()
    for (part in src.split(',')) {
        val m = PART.find(part) ?: return null
        val stepText = m.groups[4]?.value
        val ranged = m.groups[3] != null
        val star = m.groupValues[1] == STAR
        if (stepText != null && !star && !ranged) return null
        val step = if (stepText == null) 1 else stepText.toIntOrNull() ?: return null
        val a = if (star) lo else m.groupValues[2].toIntOrNull() ?: return null
        val b = if (star) hi else if (ranged) m.groupValues[3].toIntOrNull() ?: return null else a
        if (step < 1 || a < lo || b > hi || a > b) return null
        for (v in a..b step step) out.add(v)
    }
    return out
}

fun parseCron(expr: String): CronSpec? {
    val f = expr.trim().split(SPACES)
    if (f.size != CRON_FIELDS) return null
    val minute = field(f[0], 0, 59) ?: return null
    val hour = field(f[1], 0, 23) ?: return null
    val dom = field(f[2], 1, 31) ?: return null
    val month = field(f[3], 1, 12) ?: return null
    val dow = field(f[4], 0, 7)?.map { it % 7 }?.toSet() ?: return null
    // 与 Vixie cron 一致: 以 * 开头的日或星期算 "没限定"
    return CronSpec(minute, hour, dom, month, dow, f[2].startsWith(STAR), f[4].startsWith(STAR))
}

/** 5 段 cron 优先, 否则按间隔写法; 都不是返回 null。 */
fun parseTriggerExpr(expr: String): ParsedTrigger? {
    if (expr.trim().split(SPACES).size == CRON_FIELDS) return parseCron(expr)?.let { ParsedTrigger.Cron(it) }
    return parseInterval(expr)?.let { ParsedTrigger.Every(it) }
}

/** Agent 上报的时区; 没报或无效时用本机时区。 */
fun zoneOf(tz: String?): ZoneId =
    tz?.takeIf { it.isNotEmpty() && it.length <= TRIGGER_TZ_MAX }?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()

private fun dayMatch(c: CronSpec, d: LocalDate): Boolean {
    val byDom = d.dayOfMonth in c.dom
    val byDow = d.dayOfWeek.value % 7 in c.dow
    return when {
        c.domStar && c.dowStar -> true
        c.domStar -> byDow
        c.dowStar -> byDom
        else -> byDom || byDow
    }
}

// 墙上时间 wall 之后 (不含) 第一个匹配的墙上分钟
private fun nextWall(c: CronSpec, wall: LocalDateTime, limit: LocalDateTime): LocalDateTime? {
    var t = wall.truncatedTo(ChronoUnit.MINUTES).plusMinutes(1)
    var i = 0
    while (i < SEARCH_STEPS && !t.isAfter(limit)) {
        t = when {
            t.monthValue !in c.month -> t.toLocalDate().withDayOfMonth(1).plusMonths(1).atStartOfDay()
            !dayMatch(c, t.toLocalDate()) -> t.toLocalDate().plusDays(1).atStartOfDay()
            t.hour !in c.hour -> t.truncatedTo(ChronoUnit.HOURS).plusHours(1)
            t.minute !in c.minute -> t.plusMinutes(1)
            else -> return t
        }
        i++
    }
    return null
}

// 墙上时间换回时刻; 夏令时跳过的时间不存在返回 null, 重叠的取较早的那个 (偏移较大)
private fun fromWall(w: LocalDateTime, zone: ZoneId): Long? {
    val offset = zone.rules.getValidOffsets(w).maxByOrNull { it.totalSeconds } ?: return null
    return w.toInstant(offset).toEpochMilli()
}

private fun cronRuns(c: CronSpec, from: Long, count: Int, zone: ZoneId): List<Long> {
    val out = ArrayList<Long>()
    var wall = LocalDateTime.ofInstant(Instant.ofEpochMilli(from), zone)
    val limit = wall.plusDays(SEARCH_SPAN_DAYS)
    while (out.size < count) {
        val w = nextWall(c, wall, limit) ?: break
        wall = w
        val at = fromWall(w, zone)
        if (at != null && at > from && at > (out.lastOrNull() ?: Long.MIN_VALUE)) out.add(at)
    }
    return out
}

/** from 之后 (不含) 的 count 个触发时刻; 间隔写法取 base + k * 间隔 (k >= 1)。无法解析返回空。 */
fun nextRuns(expr: String, from: Long, count: Int, zone: ZoneId, base: Long = from): List<Long> {
    val n = count.coerceIn(0, COUNT_MAX)
    if (n == 0) return emptyList()
    return when (val p = parseTriggerExpr(expr)) {
        null -> emptyList()
        is ParsedTrigger.Cron -> cronRuns(p.cron, from, n, zone)
        is ParsedTrigger.Every -> {
            val e = p.every * SEC_MS
            val k = maxOf(1L, Math.floorDiv(from - base, e) + 1)
            List(n) { base + (k + it) * e }
        }
    }
}

/** zone 里 ms 所在那天之后第 days 天的 0 点 (被夏令时跳过时取当天第一个存在的时刻)。 */
fun dayStartAfter(ms: Long, days: Long, zone: ZoneId): Long =
    LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), zone).toLocalDate().plusDays(days).atStartOfDay(zone).toInstant().toEpochMilli()

/** 过了预计触发时刻 + min(间隔, 30 分钟) 还没有新的 lastRun 算迟到; viewZone 是 "今天和明天" 的日界。 */
fun triggerView(t: AgentTrigger, lastRun: Long?, now: Long, viewZone: ZoneId = ZoneId.systemDefault()): TriggerView {
    val zone = zoneOf(t.tz)
    val base = lastRun ?: t.at
    if (parseTriggerExpr(t.expr) == null) return TriggerView(false, null, emptyList(), null, false, zone)
    val ahead = nextRuns(t.expr, now, UPCOMING_MAX, zone, base)
    val end = dayStartAfter(now, DAYS_SHOWN, viewZone)
    val soon = ahead.filter { it < end }
    val pair = nextRuns(t.expr, base, 2, zone, base)
    val expected = pair.getOrNull(0)
    val gap = if (pair.size == 2) pair[1] - pair[0] else LATE_GRACE_MAX_MS
    val late = expected != null && now > expected + minOf(gap, LATE_GRACE_MAX_MS)
    return TriggerView(true, ahead.firstOrNull(), soon.ifEmpty { ahead.take(1) }, expected, late, zone)
}
