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
private const val KEY_AID = "aid"
private const val T_OVERVIEW = "overview"
private const val T_EV = "ev"
private const val T_TASK = "task"

sealed interface ServerFrame {
    /** v 为 0 表示旧 /ws 端点; v1 流还带服务端时间与会话。 */
    data class Welcome(val head: Long, val v: Int = 0, val now: Long = 0, val session: String? = null) : ServerFrame
    data class Msg(val seq: Long, val ts: Long, val src: String, val text: String, val cid: String?) : ServerFrame
    data class Sent(val cid: String, val seq: Long, val ts: Long) : ServerFrame
    data class Err(val code: String, val text: String, val aid: String? = null) : ServerFrame
    data class Metric(val subject: String, val points: List<MetricPoint>, val history: Boolean) : ServerFrame
    data class Probes(val subjects: List<String>) : ServerFrame
    data class Ev(val ev: Envelope) : ServerFrame
    data class Task(val task: TaskSnapshot) : ServerFrame
    data class ActOk(val aid: String, val state: String) : ServerFrame
    data class OverviewFrame(val overview: Overview) : ServerFrame
    // 工作台与设置暂不渲染, 只把原文交给上层, 以后接 #5 时再细化
    data class SpaceUpdate(val id: String, val deleted: Boolean, val raw: String) : ServerFrame
    data class Settings(val raw: String) : ServerFrame
}

data class MetricPoint(val ts: Long, val values: Map<String, Double>)

// 与 protocol/src/index.ts 及 protocol/src/v1/frames.ts 保持一致, 协议改动先改那边; 未知 t 忽略
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
            "welcome" -> ServerFrame.Welcome(o.optLong("head"), o.optInt("v"), o.optLong("now"), o.optString("session").ifEmpty { null })
            "msg" -> ServerFrame.Msg(
                seq = o.getLong(KEY_SEQ),
                ts = o.getLong(KEY_TS),
                src = o.optString("src"),
                text = o.optJSONObject(KEY_BODY)?.optString(KEY_TEXT).orEmpty(),
                cid = o.optString(KEY_CID).ifEmpty { null },
            )
            "sent" -> ServerFrame.Sent(o.optString(KEY_CID), o.getLong(KEY_SEQ), o.getLong(KEY_TS))
            "err" -> ServerFrame.Err(o.optString("code"), o.optString(KEY_TEXT), o.optString(KEY_AID).ifEmpty { null })
            "metric" -> parseMetric(o)
            "probes" -> ServerFrame.Probes(V1Decode.strings(o.optJSONArray("subjects")))
            T_EV -> ServerFrame.Ev(V1Decode.envelope(o.getJSONObject(T_EV)))
            T_TASK -> ServerFrame.Task(V1Decode.task(o.getJSONObject(T_TASK)))
            "act_ok" -> ServerFrame.ActOk(o.getString(KEY_AID), o.optString("state"))
            T_OVERVIEW -> ServerFrame.OverviewFrame(V1Decode.overview(o.getJSONObject(T_OVERVIEW)))
            "space_update" -> ServerFrame.SpaceUpdate(o.optString("id"), o.optBoolean("deleted"), o.toString())
            "settings" -> ServerFrame.Settings(o.optJSONObject("settings")?.toString() ?: "{}")
            else -> null
        }
    }

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

    /** 用户对任务的动作, aid 用于幂等; 危险动作需要 confirm。 */
    fun act(aid: String, taskId: String, kind: String, option: String? = null, text: String? = null, confirm: Boolean = false): String {
        val o = JSONObject().put(KEY_T, "act").put(KEY_AID, aid).put("taskId", taskId).put(KEY_KIND, kind)
        option?.let { o.put("option", it) }
        text?.let { o.put(KEY_TEXT, it) }
        if (confirm) o.put("confirm", true)
        return o.toString()
    }

    fun overview(): String = JSONObject().put(KEY_T, T_OVERVIEW).toString()

    fun reg(pushToken: String): String = JSONObject().put(KEY_T, "reg").put("pushToken", pushToken).toString()
}
