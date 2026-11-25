package com.hengxin.aioa.ui.chat

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private const val TR_PATH = "api/v1/translate"
private const val TR_TO = "zh-Hans"
private const val FMT_HTML = "html"
private const val FMT_TEXT = "text"
// 第一批小一点, 先把屏幕上能看到的几段换掉
private const val FIRST_BATCH = 12
private const val MAX_BATCH = 100
private const val MAX_CHARS = 28000
private const val MAX_SEG = 4500
private const val MIN_LETTERS = 8
private const val CACHE_SIZE = 30

private val TR_TOKEN = Regex("<!--[\\s\\S]*?-->|<(/?)([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*>")
private val TR_ANY_TAG = Regex("<[^>]*>")
private val TR_ENTITY = Regex("&[a-zA-Z#0-9]+;")
private val LINK_ONLY = Regex("^(https?://\\S+|\\S+@\\S+\\.\\S+)$")
// 这些标签里的内容不翻
private val TR_SKIP = setOf("style", "script", "head", "title", "noscript", "svg", "code", "textarea")
// 块级标签: 段落边界
private val TR_BLOCK = setOf(
    "html", "body", "p", "div", "td", "th", "tr", "table", "tbody", "thead", "tfoot", "li", "ul", "ol", "dl", "dt", "dd",
    "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "blockquote", "section", "article", "header", "footer", "center", "pre",
    "main", "nav", "aside", "figure", "figcaption", "form", "img",
)

/** 译文段: 原文 [start, end) 一段 HTML (只含行内标签)。 */
data class TrSeg(val start: Int, val end: Int, val raw: String)

/** 按块级标签切段, 跳过样式脚本和不需要翻的段 (中文, 数字, 纯链接)。 */
fun trSegments(html: String): List<TrSeg> {
    val out = ArrayList<TrSeg>()
    var skip: String? = null
    var segStart = -1
    var pos = 0
    fun close(end: Int) {
        if (segStart >= 0 && end > segStart) {
            val raw = html.substring(segStart, end)
            if (raw.length <= MAX_SEG && needsTr(plainOf(raw))) out.add(TrSeg(segStart, end, raw))
        }
        segStart = -1
    }
    for (t in TR_TOKEN.findAll(html)) {
        val name = t.groupValues[2].lowercase()
        val closing = t.groupValues[1] == "/"
        if (skip != null) {
            if (closing && name == skip) { skip = null; pos = t.range.last + 1 }
            continue
        }
        if (t.range.first > pos && segStart < 0) segStart = pos
        when {
            name.isEmpty() || name in TR_BLOCK -> close(t.range.first)
            !closing && name in TR_SKIP -> { close(t.range.first); skip = name }
            segStart < 0 -> segStart = t.range.first
        }
        pos = t.range.last + 1
    }
    if (skip == null) {
        if (pos < html.length && segStart < 0) segStart = pos
        close(html.length)
    }
    return out
}

private fun plainOf(raw: String) = raw.replace(TR_ANY_TAG, "").replace(TR_ENTITY, " ").trim()

/** 和服务端的跳过规则一致: 没有字母, 纯链接或邮箱, 中文都不翻。 */
fun needsTr(text: String): Boolean {
    val t = text.trim()
    if (t.isEmpty() || LINK_ONLY.matches(t)) return false
    val s = scriptOf(t)
    if (s.letters == 0) return false
    return s.kana + s.hangul > 0 || s.han * 2 < s.letters
}

private class Script(var letters: Int = 0, var han: Int = 0, var kana: Int = 0, var hangul: Int = 0, var cyr: Int = 0, var accented: Int = 0)

private fun scriptOf(t: String): Script {
    val s = Script()
    t.forEach { ch ->
        if (!Character.isLetter(ch)) return@forEach
        s.letters++
        when (Character.UnicodeScript.of(ch.code)) {
            Character.UnicodeScript.HAN -> s.han++
            Character.UnicodeScript.HIRAGANA, Character.UnicodeScript.KATAKANA -> s.kana++
            Character.UnicodeScript.HANGUL -> s.hangul++
            Character.UnicodeScript.CYRILLIC -> s.cyr++
            else -> if (ch.code > 0x7f) s.accented++
        }
    }
    return s
}

/** 邮件是哪种外文, 显示用; 中文或字太少返回 null (不出现翻译那一行)。 */
fun trLangOf(text: String): String? {
    val s = scriptOf(text)
    if (s.letters < MIN_LETTERS || !needsTr(text)) return null
    return when {
        s.kana > 0 -> "日文"
        s.hangul > 0 -> "韩文"
        s.cyr * 2 > s.letters -> "俄文"
        s.accented * 50 > s.letters -> "外文"
        else -> "英文"
    }
}

/** 把译文填回原位; withOrig 时每段后面藏一份原文, 按住那一段才显示。 */
fun trApply(html: String, segs: List<TrSeg>, tr: Map<Int, String>, withOrig: Boolean): String {
    val sb = StringBuilder(html.length * 2)
    var last = 0
    segs.forEachIndexed { i, s ->
        val t = tr[i] ?: return@forEachIndexed
        sb.append(html, last, s.start)
        if (withOrig) sb.append("<span class=\"hx-t\">").append(t).append("<span class=\"hx-o\">").append(s.raw).append("</span></span>")
        else sb.append(t)
        last = s.end
    }
    sb.append(html, last, html.length)
    return sb.toString()
}

/** 按住某段显示原文, 松手收起; 页面不跑脚本, 只靠 CSS。 */
const val TR_CSS = ".hx-o{display:none}.hx-t:active .hx-o,.hx-t:hover .hx-o{display:block;margin:4px 0;padding:6px 8px;" +
    "border-left:3px solid #2f6bff;background:#f4f7ff;color:#555;font-size:.9em;border-radius:0 6px 6px 0}"

/** 一封信的翻译状态; 译完缓存在进程里, 切回原文再切回译文不重新请求。 */
class MailTr(val id: String) {
    var phase by mutableStateOf(PHASE_IDLE)
    var showing by mutableStateOf(false)
    var done by mutableIntStateOf(0)
    var total by mutableIntStateOf(0)
    var subject by mutableStateOf<String?>(null)
    var summary by mutableStateOf<String?>(null)
    var page by mutableStateOf<String?>(null)
    var bare by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)

    /** 翻标题和正文 (没有正文就翻摘要), 一批好了就换上一批。 */
    suspend fun run(context: Context, m: MailItem, html: String?) {
        if (phase == PHASE_DONE) { showing = true; return }
        phase = PHASE_RUNNING
        error = null
        done = 0
        try {
            subject = if (needsTr(m.subject)) call(context, listOf(m.subject), FMT_TEXT).first() else null
            if (html == null) {
                total = 1
                summary = if (needsTr(m.summary)) call(context, listOf(m.summary), FMT_TEXT).first() else null
                done = 1
            } else {
                translateBody(context, html)
            }
            phase = PHASE_DONE
            showing = true
        } catch (e: CancellationException) {
            reset()
            throw e
        } catch (e: Exception) {
            reset()
            phase = PHASE_ERROR
            error = e.message ?: "翻译失败"
        }
    }

    private suspend fun translateBody(context: Context, html: String) {
        val segs = withContext(Dispatchers.Default) { trSegments(html) }
        total = segs.size
        val got = HashMap<Int, String>()
        var i = 0
        while (i < segs.size) {
            var n = 0
            var chars = 0
            val cap = if (i == 0) FIRST_BATCH else MAX_BATCH
            while (i + n < segs.size && n < cap && chars + segs[i + n].raw.length <= MAX_CHARS) { chars += segs[i + n].raw.length; n++ }
            val part = call(context, segs.subList(i, i + n).map { it.raw }, FMT_HTML)
            part.forEachIndexed { k, t -> got[i + k] = t }
            i += n
            done = i
            page = trApply(html, segs, got, true)
            showing = true
        }
        bare = trApply(html, segs, got, false)
    }

    private fun reset() {
        phase = PHASE_IDLE
        showing = false
        page = null
        bare = null
        subject = null
        summary = null
    }

    private suspend fun call(context: Context, texts: List<String>, format: String): List<String> = withContext(Dispatchers.IO) {
        val body = JSONObject().put("texts", JSONArray(texts)).put("to", TR_TO).put("format", format)
        val r = Api.call(context, "POST", listOf(TR_PATH), body)
        val arr = r.body?.optJSONArray("texts") ?: error(r.error ?: "翻译失败")
        if (arr.length() != texts.size) error("翻译结果不完整")
        (0 until arr.length()).map { arr.optString(it) }
    }

    companion object {
        private val cache = object : LinkedHashMap<String, MailTr>(CACHE_SIZE, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, MailTr>) = size > CACHE_SIZE
        }

        fun of(id: String): MailTr = synchronized(cache) { cache.getOrPut(id) { MailTr(id) } }
    }
}

/** 本月用量: 已翻字符数与通道名。 */
suspend fun trUsage(context: Context): Pair<Long, String>? = withContext(Dispatchers.IO) {
    runCatching {
        val b = Api.call(context, "GET", listOf(TR_PATH, "usage")).body ?: return@runCatching null
        b.optLong("used") to (TR_PROVIDER[b.optString("provider")] ?: b.optString("provider"))
    }.getOrNull()
}

private val TR_PROVIDER = mapOf("google" to "谷歌翻译", "azure" to "微软翻译")

const val PHASE_IDLE = 0
const val PHASE_RUNNING = 1
const val PHASE_DONE = 2
const val PHASE_ERROR = 3
