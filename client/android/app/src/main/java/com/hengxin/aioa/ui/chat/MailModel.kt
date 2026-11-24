package com.hengxin.aioa.ui.chat

import android.content.Context
import android.text.format.DateUtils
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.Calendar

/** 同一主题的一串信, items 按时间倒序, 第一封是最新的。 */
class MailThread(val key: String, val items: List<MailItem>) {
    val head get() = items.first()
}

// 主题归一: 去掉回复 / 转发前缀和末尾的提交号, "Run failed: x (a1c9e0f)" 会并到一起
private val PREFIX = Regex("^\\s*((re|fw|fwd|回复|答复|转发)\\s*[:：]\\s*)+", RegexOption.IGNORE_CASE)
private val TAIL_SHA = Regex("\\s*\\([0-9a-f]{7,40}\\)\\s*$")

fun threadKey(m: MailItem): String = m.vendor + "|" + m.subject.replace(PREFIX, "").replace(TAIL_SHA, "").trim().lowercase()

fun threadsOf(items: List<MailItem>): List<MailThread> =
    items.groupBy(::threadKey).map { (k, v) -> MailThread(k, v.sortedByDescending { it.ts }) }.sortedByDescending { it.head.ts }

/** 按最新一封的日期分段: 今天 / 昨天 / 本周 / 本月 / 年月。 */
fun sectionsOf(threads: List<MailThread>, now: Long = System.currentTimeMillis()): List<Pair<String, List<MailThread>>> {
    val day = Calendar.getInstance().apply { timeInMillis = now; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
    val week = day - WEEK_DAYS * DateUtils.DAY_IN_MILLIS
    val month = Calendar.getInstance().apply { timeInMillis = day; set(Calendar.DAY_OF_MONTH, 1) }.timeInMillis
    fun label(ts: Long): String = when {
        ts >= day -> "今天"
        ts >= day - DateUtils.DAY_IN_MILLIS -> "昨天"
        ts >= week -> "本周"
        ts >= month -> "本月"
        else -> Calendar.getInstance().apply { timeInMillis = ts }.let { "${it.get(Calendar.YEAR)} 年 ${it.get(Calendar.MONTH) + 1} 月" }
    }
    return threads.groupBy { label(it.head.ts) }.toList()
}

private const val WEEK_DAYS = 6

fun mailTime(context: Context, ts: Long): String = when {
    DateUtils.isToday(ts) -> DateUtils.formatDateTime(context, ts, DateUtils.FORMAT_SHOW_TIME)
    DateUtils.isToday(ts + DateUtils.DAY_IN_MILLIS) -> "昨天"
    else -> DateUtils.formatDateTime(context, ts, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH or DateUtils.FORMAT_NO_YEAR)
}

const val UNKNOWN_ACCOUNT = "未知收件人"

// 服务端 "资源不存在": 这封信已经被删过
private const val GONE = "资源不存在"
fun accountLabel(key: String) = key.ifEmpty { UNKNOWN_ACCOUNT }

/** 邮件群的状态: 账号, 分类, 厂商, 搜索, 已加载的信与统计。离开再回来不重拉。 */
class MailState(val api: MailApi, val seen: MailSeen) {
    // null = 全部收件箱; "" = 未知收件人
    var account by mutableStateOf<String?>(null)
    var category by mutableStateOf<String?>(null)
    var vendor by mutableStateOf<String?>(null)
    var vendors by mutableStateOf(false)
    var search by mutableStateOf("")
    var query by mutableStateOf<String?>(null)
    val items = mutableStateListOf<MailItem>()
    var more by mutableStateOf(false)
    var loading by mutableStateOf(false)
    var refreshing by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var facets by mutableStateOf(MailFacets(emptyList(), emptyList(), emptyList()))
    var open by mutableStateOf<String?>(null)
    var sheet by mutableStateOf(false)
    // 左滑展开删除按钮的那一行; 同一时间只展开一行
    var swiped by mutableStateOf<String?>(null)
    private val removing = mutableSetOf<Long>()

    val filter get() = MailFilter(category, vendor, account)
    val threads get() = threadsOf(items)
    val title get() = account?.let(::accountLabel) ?: "全部收件箱"
    val total get() = facets.accounts.sumOf { it.count }

    suspend fun reload() {
        loading = true
        api.list(filter, query, null).onSuccess { items.clear(); items.addAll(it.items); more = it.more; error = null }.onFailure { error = it.message }
        api.facets().onSuccess { facets = it }
        loading = false
        refreshing = false
    }

    suspend fun older() {
        if (loading || !more) return
        loading = true
        api.list(filter, query, items.lastOrNull()?.ts).onSuccess { p -> items.addAll(p.items.filter { n -> items.none { it.seq == n.seq } }); more = p.more }.onFailure { error = it.message }
        loading = false
    }

    suspend fun remove(t: MailThread) {
        // 已在删除中的不重复发; 已经不在服务端的 (别处删过) 也当作删掉了
        for (m in t.items) {
            if (!removing.add(m.seq)) continue
            val r = api.remove(m.seq)
            val err = r.exceptionOrNull()?.message
            if (r.isSuccess || err == GONE) items.removeAll { it.seq == m.seq } else error = err
            removing.remove(m.seq)
        }
        if (open == t.key) open = null
    }
}
