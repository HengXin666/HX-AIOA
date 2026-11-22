package com.hengxin.aioa.proto

import com.hengxin.aioa.Constants
import org.json.JSONArray
import org.json.JSONObject

private const val KEY_ID = "id"
private const val KEY_TITLE = "title"
private const val KEY_SUMMARY = "summary"
private const val KEY_LABEL = "label"
private const val KEY_STYLE = "style"
private const val KEY_URL = "url"
private const val KEY_SUBJECT = "subject"
private const val KEY_STATE = "state"
private const val KEY_NAME = "name"

// v1 帧解析: 只认识的字段才读, 多余字段与未知 kind 一律忽略, 缺必需字段时整帧丢弃
internal object V1Decode {

    fun envelope(o: JSONObject): Envelope {
        val kind = o.optString("kind", Constants.KIND_EVENT)
        val data = o.optJSONObject("data") ?: JSONObject()
        val task = if (kind == Constants.KIND_TASK) task(data) else null
        val src = o.optJSONObject("source") ?: JSONObject()
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
            summary = task?.summary ?: opt(data, KEY_SUMMARY),
            severity = opt(data, "severity"),
            status = opt(data, "status"),
            url = opt(data, KEY_URL),
            values = numbers(data.optJSONObject("values")),
            task = task,
            dedupeKey = opt(o, "dedupeKey"),
        )
    }

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

/** 写进旧消息库的形状: 聊天页与通知继续按 Msg 工作; 本机发出的保留设备 id 以便识别 "我"。 */
fun Envelope.toMsg(): ServerFrame.Msg {
    val src = if (source.id.startsWith(Constants.DEVICE_PREFIX)) source.id else source.name.ifEmpty { source.id }
    return ServerFrame.Msg(seq, ts, src, preview(), null)
}

/** 是否应该弹通知: 路由明确要求安静, 指标或已恢复的事件都不打扰。 */
fun Envelope.shouldNotify(): Boolean =
    route !in Constants.QUIET_ROUTES && kind != Constants.KIND_METRIC && !resolved
