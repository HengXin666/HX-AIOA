package com.hengxin.aioa.proto

import org.json.JSONArray
import org.json.JSONObject

private const val KEY_T = "t"
private const val KEY_SEQ = "seq"
private const val KEY_TS = "ts"
private const val KEY_CID = "cid"
private const val KEY_BODY = "body"
private const val KEY_KIND = "kind"
private const val KEY_TEXT = "text"
private const val KIND_TEXT = "text"
private const val KEY_POINTS = "points"

sealed interface ServerFrame {
    data class Welcome(val head: Long) : ServerFrame
    data class Msg(val seq: Long, val ts: Long, val src: String, val text: String, val cid: String?) : ServerFrame
    data class Sent(val cid: String, val seq: Long, val ts: Long) : ServerFrame
    data class Err(val code: String, val text: String) : ServerFrame
    data class Metric(val subject: String, val points: List<MetricPoint>, val history: Boolean) : ServerFrame
    data class Probes(val subjects: List<String>) : ServerFrame
}

data class MetricPoint(val ts: Long, val values: Map<String, Double>)

// 与 protocol/src/index.ts 保持一致, 协议改动先改那边
object Frames {
    const val PING = "ping"
    const val PONG = "pong"

    fun parse(raw: String): ServerFrame? {
        if (raw == PONG) return null
        val o = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        return runCatching { decode(o) }.getOrNull()
    }

    private fun decode(o: JSONObject): ServerFrame? {
        return when (o.optString(KEY_T)) {
            "welcome" -> ServerFrame.Welcome(o.optLong("head"))
            "msg" -> ServerFrame.Msg(
                seq = o.getLong(KEY_SEQ),
                ts = o.getLong(KEY_TS),
                src = o.optString("src"),
                text = o.optJSONObject(KEY_BODY)?.optString(KEY_TEXT).orEmpty(),
                cid = o.optString(KEY_CID).ifEmpty { null },
            )
            "sent" -> ServerFrame.Sent(o.optString(KEY_CID), o.getLong(KEY_SEQ), o.getLong(KEY_TS))
            "err" -> ServerFrame.Err(o.optString("code"), o.optString(KEY_TEXT))
            "metric" -> parseMetric(o)
            "probes" -> ServerFrame.Probes(strings(o.optJSONArray("subjects")))
            else -> null
        }
    }

    private fun strings(a: JSONArray?): List<String> = a?.let { arr -> (0 until arr.length()).map { arr.getString(it) } }.orEmpty()

    private fun parseMetric(o: JSONObject): ServerFrame.Metric {
        val arr = o.optJSONArray(KEY_POINTS) ?: JSONArray()
        val points = (0 until arr.length()).map { i ->
            val p = arr.getJSONObject(i)
            val v = p.getJSONObject("values")
            MetricPoint(p.getLong(KEY_TS), v.keys().asSequence().associateWith { v.getDouble(it) })
        }
        return ServerFrame.Metric(o.optString("subject"), points, o.optBoolean("history"))
    }

    /** 声明当前在看的主体, 空列表表示不看了; 页面离开或进入后台时必须发空列表。 */
    fun watch(subjects: List<String>): String = JSONObject().put(KEY_T, "watch").put("subjects", JSONArray(subjects)).toString()

    fun send(cid: String, text: String): String = JSONObject()
        .put(KEY_T, "send")
        .put(KEY_CID, cid)
        .put(KEY_BODY, JSONObject().put(KEY_KIND, KIND_TEXT).put(KEY_TEXT, text))
        .toString()

    fun ack(seq: Long): String = JSONObject().put(KEY_T, "ack").put(KEY_SEQ, seq).toString()

    fun reg(pushToken: String): String = JSONObject().put(KEY_T, "reg").put("pushToken", pushToken).toString()
}
