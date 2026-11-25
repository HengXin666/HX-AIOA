package com.hengxin.aioa.ui.feed

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.proto.ServerFrame
import org.json.JSONObject

/** 统一推送卡片的一条, 字段与 protocol/src/v1/feed.ts 一致; key 用于去重和本地标记。 */
data class FeedItem(
    val key: String,
    val title: String,
    val url: String?,
    val site: String?,
    val kind: String,
    val status: String?,
    val summary: String?,
    val todo: String?,
    val until: String?,
    val heat: Int?,
    val links: List<Pair<String, String>>,
    val source: String,
    val ts: Long,
    val seq: Long,
    // 旧格式推送的原 HTML 卡片, 没有链接时点开看它
    val html: String? = null,
)

const val ST_OK = "ok"
const val ST_GO = "go"
const val ST_DOUBT = "doubt"
const val ST_DEAD = "dead"
val STATUS_LABEL = mapOf(ST_OK to "有效", ST_GO to "进行中", ST_DOUBT to "存疑", ST_DEAD to "失效")

private fun JSONObject.s(k: String) = optString(k).trim().ifEmpty { null }

/** 解析一条消息的 data.feed; 没有 feed 的旧格式消息交给 legacyItems 拆条, 让信息流里样式也统一。 */
fun feedOf(m: ServerFrame.Msg, tags: List<FeedTag> = DEFAULT_TAGS): List<FeedItem> {
    val raw = m.feed?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return legacyItems(m, tags)
    val source = raw.s("source") ?: m.src
    val arr = raw.optJSONArray("items") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        val title = o.s("title") ?: return@mapNotNull null
        val url = o.s("url")
        val links = o.optJSONArray("links")?.let { a -> (0 until a.length()).mapNotNull { j -> a.optJSONObject(j)?.let { l -> l.s("label")?.let { lb -> l.s("url")?.let { u -> lb to u } } } } }.orEmpty()
        FeedItem(
            key = o.s("id") ?: url ?: "$source:$title",
            title = title, url = url, site = o.s("site"),
            kind = o.s("kind") ?: TAG_OTHER,
            status = o.s("status")?.takeIf { it in STATUS_LABEL },
            summary = o.s("summary"), todo = o.s("todo"), until = o.s("until"),
            heat = if (o.has("heat")) o.optDouble("heat").toInt() else null,
            links = links, source = source, ts = m.ts, seq = m.seq,
        )
    }
}

/** 群里所有条目, 新的在前; 同 key 只留最新一次推送。 */
fun feedItems(messages: List<ServerFrame.Msg>, tags: List<FeedTag> = DEFAULT_TAGS): List<FeedItem> {
    val seen = HashSet<String>()
    return messages.sortedByDescending { it.seq }.flatMap { feedOf(it, tags) }.filter { seen.add(it.key) }
}

/** 本机的标记: 用过了, 我标的失效, 收藏。界面读 version 重组。 */
class FeedMarks(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val sets = KEYS.associateWith { prefs.getStringSet(it, emptySet()).orEmpty().toMutableSet() }
    var version by mutableIntStateOf(0)
        private set

    fun has(set: String, key: String) = key in sets.getValue(set)

    fun toggle(set: String, key: String) {
        val s = sets.getValue(set)
        if (!s.remove(key)) s.add(key)
        if (s.size > MAX_KEYS) s.retainAll(s.toList().takeLast(MAX_KEYS).toSet())
        prefs.edit().putStringSet(set, s.toSet()).apply()
        version++
    }

    /** 实际状态: 我标了失效就是失效, 否则用推送方给的。 */
    fun status(it: FeedItem): String? = if (has(DEAD, it.key)) ST_DEAD else it.status

    companion object {
        const val USED = "used"
        const val DEAD = "dead"
        const val STAR = "star"
        private val KEYS = listOf(USED, DEAD, STAR)
        private const val PREFS = "feed-marks"
        private const val MAX_KEYS = 1000

        @Volatile private var inst: FeedMarks? = null
        fun of(context: Context): FeedMarks = inst ?: synchronized(this) { inst ?: FeedMarks(context.applicationContext).also { inst = it } }
    }
}
