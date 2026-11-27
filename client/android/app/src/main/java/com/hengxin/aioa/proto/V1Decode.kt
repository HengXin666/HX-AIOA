package com.hengxin.aioa.proto

import com.hengxin.aioa.Constants
import com.hengxin.aioa.data.Me
import org.json.JSONArray
import org.json.JSONObject

private const val KEY_ID = "id"
private const val KEY_DELETED = "deleted"
private const val KEY_TITLE = "title"
private const val KEY_SUMMARY = "summary"
private const val KEY_LABEL = "label"
private const val KEY_STYLE = "style"
private const val KEY_URL = "url"
private const val KEY_SUBJECT = "subject"
private const val KEY_STATE = "state"
private const val KEY_NAME = "name"
private const val KEY_HTML = "html"
private val HTML_SHAPE = Regex("^<(!doctype|html|div|section|article|table|p|h[1-6]|style|body|main|span|ul|ol)[\\s>]", RegexOption.IGNORE_CASE)
private val HTML_DROP = Regex("<(style|script)[\\s\\S]*?</\\1>", RegexOption.IGNORE_CASE)
private val HTML_BREAK = Regex("<(br|/p|/div|/li|/h[1-6]|/tr)[^>]*>", RegexOption.IGNORE_CASE)
private val HTML_TAG = Regex("<[^>]+>")

/** 与服务端同一规则: 整段以常见块级标签开头并以 > 结尾才算 HTML。 */
fun looksHtml(text: String): Boolean = text.trim().let { HTML_SHAPE.containsMatchIn(it) && it.endsWith(">") }

fun htmlText(html: String): String = html.replace(HTML_DROP, "").replace(HTML_BREAK, "\n").replace(HTML_TAG, "")
    .replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&amp;", "&")
    .lines().map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n")

// v1 帧解析: 只认识的字段才读, 多余字段与未知 kind 一律忽略, 缺必需字段时整帧丢弃
internal object V1Decode {

    fun envelope(o: JSONObject): Envelope {
        val kind = o.optString("kind", Constants.KIND_EVENT)
        val data = o.optJSONObject("data") ?: JSONObject()
        val task = if (kind == Constants.KIND_TASK) task(data) else null
        val src = o.optJSONObject("source") ?: JSONObject()
        // 旧推送方把整段 HTML 塞进了 summary: 当成 HTML 卡片, 摘要只留文字
        val rawSummary = task?.summary ?: opt(data, KEY_SUMMARY)
        val sniffed = rawSummary?.takeIf { !data.has(KEY_HTML) && looksHtml(it) }
        return Envelope(
            id = o.getString(KEY_ID),
            seq = o.optLong("seq"),
            ts = o.optLong("ts"),
            kind = kind,
            source = SourceRef(src.optString(KEY_ID), src.optString(KEY_NAME).ifEmpty { src.optString(KEY_ID) }, opt(src, "icon"), opt(src, "type")),
            subject = opt(o, KEY_SUBJECT),
            channel = opt(o, "channel"),
            priority = o.optString("priority", Constants.PRIORITY_HAPPENING),
            groupKey = opt(o, "groupKey"),
            actions = list(o.optJSONArray("actions")) { EventAction(it.getString(KEY_ID), it.optString(KEY_LABEL), opt(it, KEY_STYLE), opt(it, KEY_URL)) },
            resolved = o.optBoolean("resolved"),
            route = o.optJSONObject("route")?.let { opt(it, "action") },
            title = task?.title ?: data.optString(KEY_TITLE).ifEmpty { data.optString("text") },
            summary = sniffed?.let(::htmlText) ?: rawSummary,
            severity = opt(data, "severity"),
            status = opt(data, "status"),
            url = opt(data, KEY_URL),
            values = numbers(data.optJSONObject("values")),
            task = task,
            dedupeKey = opt(o, "dedupeKey"),
            markdown = opt(data, "markdown"),
            html = opt(data, KEY_HTML) ?: sniffed,
            feed = data.optJSONObject("feed")?.toString(),
            mail = data.optJSONObject("mail")?.toString(),
            cid = opt(o, "cid"),
            reply = o.optJSONObject("reply")?.let(::ref),
            fwd = o.optJSONObject("fwd")?.let { FwdInfo(it.optString("src"), it.optLong("ts")) },
            deleted = o.optJSONObject(KEY_DELETED)?.let { opt(it, "mode") },
            deletedSeq = o.optJSONObject(KEY_DELETED)?.optLong("seq") ?: 0L,
            by = opt(o, "by"),
            file = FileRef.parse(data.optJSONObject("file")),
            mentions = strings(o.optJSONArray("mentions")),
            bundle = Bundle.parse(data.optJSONObject("bundle")),
        )
    }

    fun ref(o: JSONObject): MsgRef = MsgRef(o.optLong("seq"), o.optString("src"), o.optString("text"))

    fun task(o: JSONObject): TaskSnapshot = TaskSnapshot(
        id = o.getString(KEY_ID),
        agent = o.optString("agent"),
        title = o.optString(KEY_TITLE),
        summary = opt(o, KEY_SUMMARY),
        subject = opt(o, KEY_SUBJECT),
        state = o.optString(KEY_STATE, Constants.TASK_RUNNING),
        progress = if (o.has("progress")) o.optDouble("progress") else null,
        step = opt(o, "step"),
        prompt = o.optJSONObject("prompt")?.let(::prompt),
        result = opt(o, "result"),
        error = opt(o, "error"),
        created = o.optLong("created"),
        updated = o.optLong("updated"),
    )

    fun overview(o: JSONObject): Overview {
        val layers = o.optJSONObject("layers") ?: JSONObject()
        val map = layers.keys().asSequence().associateWith { key ->
            list(layers.optJSONArray(key)) { item ->
                OverviewItem(envelope(item.getJSONObject("ev")), item.optInt("count", 1), strings(item.optJSONArray("ids")))
            }
        }
        return Overview(map, list(o.optJSONArray("tasks"), ::task), o.optLong("generatedAt"))
    }

    private fun prompt(o: JSONObject): Prompt = Prompt(
        id = o.optString(KEY_ID),
        question = o.optString("question"),
        options = list(o.optJSONArray("options")) { PromptOption(it.getString(KEY_ID), it.optString(KEY_LABEL), opt(it, KEY_STYLE)) },
        allowText = o.optBoolean("allowText"),
        danger = o.optBoolean("danger"),
        expires = if (o.has("expires")) o.optLong("expires") else null,
        expired = o.optBoolean("expired"),
    )

    fun agents(a: JSONArray?): List<AgentStatus> = list(a) { o ->
        AgentStatus(o.getString("id"), o.optString("name").ifEmpty { o.getString("id") }, o.optBoolean("online"), o.optLong("lastSeen"))
    }

    fun strings(a: JSONArray?): List<String> =
        a?.let { arr -> (0 until arr.length()).mapNotNull { arr.opt(it) as? String } }.orEmpty()

    // 逐项解析, 单项坏了只丢这一项
    private fun <T> list(a: JSONArray?, map: (JSONObject) -> T): List<T> =
        a?.let { arr -> (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let { runCatching { map(it) }.getOrNull() } } }.orEmpty()

    private fun numbers(o: JSONObject?): Map<String, Double> =
        o?.keys()?.asSequence()?.mapNotNull { k -> (o.opt(k) as? Number)?.let { k to it.toDouble() } }?.toMap().orEmpty()

    private fun opt(o: JSONObject, key: String): String? = if (o.isNull(key)) null else o.optString(key).ifEmpty { null }
}

/** 旧客户端视角: 任何事件压成一行文字, 与 protocol 的 previewOfEnvelope 一致, 供消息库与通知沿用。 */
fun Envelope.preview(): String = when (kind) {
    Constants.KIND_REPORT -> "[报告] $title"
    Constants.KIND_TASK -> "[任务 ${task?.state.orEmpty()}] $title"
    Constants.KIND_METRIC -> values.entries.joinToString(" ") { "${it.key}=${it.value}" }
    else -> summary?.let { "$title: $it" } ?: title
}

/** 写进旧消息库的形状: 聊天页与通知继续按 Msg 工作; "我" 发的 src 以设备前缀开头, 别人发的用显示名。 */
fun Envelope.toMsg(): ServerFrame.Msg {
    val me = Me.uid
    // 自己发的: 有账号按 by 比; 没有 by 的旧消息按来源是人 (旧: 设备 id 前缀) 判断
    val human = source.type == Constants.SOURCE_TYPE_USER || source.id.startsWith(Constants.DEVICE_PREFIX)
    val mine = if (by != null && me != null) by == me else human
    val src = if (mine && source.id.startsWith(Constants.DEVICE_PREFIX)) Me.label else source.name.ifEmpty { source.id }
    return ServerFrame.Msg(seq, ts, src, chatText(), cid, channel?.ifEmpty { null }, reply, fwd, html, id, deleted, deletedSeq, file, mine, source.id, feed, mentions, bundle)
}

/** 聊天里显示的正文 (Markdown): 报告带标题与全文, 有标题的消息标题加粗; 纯文本消息 summary 就是原文。 */
fun Envelope.chatText(): String = when (kind) {
    Constants.KIND_REPORT -> "## $title\n\n" + (markdown ?: summary.orEmpty())
    Constants.KIND_EVENT -> when {
        summary == null -> title
        summary.startsWith(title) -> summary
        else -> "**$title**\n$summary"
    }
    else -> preview()
}

/** 是否应该弹通知: 路由明确要求安静, 指标或已恢复的事件都不打扰。 */
fun Envelope.shouldNotify(): Boolean =
    route !in Constants.QUIET_ROUTES && kind != Constants.KIND_METRIC && !resolved
