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
private const val KEY_SID = "sid"
private const val KEY_COLS = "cols"
private const val KEY_ROWS = "rows"

sealed interface ServerFrame {
    /** v 为 0 表示旧 /ws 端点; v1 流还带服务端时间与会话。 */
    /** resync: 断线太久, 本地 seq < floor 的缓存可能漏了删除, 要丢掉。 */
    /** uid: 当前账号 id, 与消息的 by 比较认出自己发的。 */
    data class Welcome(val head: Long, val v: Int = 0, val now: Long = 0, val session: String? = null, val resync: Boolean = false, val floor: Long = 0, val uid: String? = null, val name: String? = null, val compat: Compat? = null) : ServerFrame
    // group: 事件的 channel, 即消息所在的群; 旧消息与本机发出的没有
    data class Msg(
        val seq: Long,
        val ts: Long,
        val src: String,
        val text: String,
        val cid: String?,
        val group: String? = null,
        val reply: MsgRef? = null,
        val fwd: FwdInfo? = null,
        // 推送方给的 HTML 卡片 (周报之类), 在沙箱 WebView 里渲染
        val html: String? = null,
        // 事件 id: 同 id 的新版本 (更新, 撤回) 换新 seq, 本地据此替换旧行
        val id: String? = null,
        val deleted: String? = null,
        val deletedSeq: Long = 0,
        val file: FileRef? = null,
        // 是不是自己 (当前账号) 发的; 来源 id (user:<uid> / Agent 来源 id), 用来按 id 取最新名字
        val mine: Boolean = false,
        val sid: String? = null,
        // 统一推送卡片 (data.feed 原始 JSON)
        val feed: String? = null,
    ) : ServerFrame
    data class Sent(val cid: String, val seq: Long, val ts: Long) : ServerFrame
    data class Err(val code: String, val text: String, val aid: String? = null) : ServerFrame
    data class Metric(val subject: String, val points: List<MetricPoint>, val history: Boolean) : ServerFrame
    data class Probes(val subjects: List<String>) : ServerFrame
    data class Hosts(val hosts: List<HostCard>) : ServerFrame
    data class Ev(val ev: Envelope) : ServerFrame
    data class Task(val task: TaskSnapshot) : ServerFrame
    data class ActOk(val aid: String, val state: String) : ServerFrame
    data class OverviewFrame(val overview: Overview, val raw: String = "") : ServerFrame
    // 工作台与设置暂不渲染, 只把原文交给上层, 以后接 #5 时再细化
    data class SpaceUpdate(val id: String, val deleted: Boolean, val raw: String) : ServerFrame
    data class Settings(val raw: String) : ServerFrame
    data class Agents(val agents: List<AgentStatus>) : ServerFrame
    data class ChatSync(val topic: String, val channel: String?) : ServerFrame
    /** 插件数据有变: 按 rev 增量拉。 */
    data class PDataSync(val plugin: String, val coll: String, val rev: Long) : ServerFrame
    /** 群里谁在监听 / 输入; until 为 0 表示长连在线, 否则到点自动消失。 */
    data class Presence(val channel: String, val listening: List<PresenceEntry>, val typing: List<PresenceEntry>) : ServerFrame
    data class TaskLog(val taskId: String, val role: String, val kind: String, val text: String?, val ts: Long) : ServerFrame
    // 终端: d 为 base64 字节, 原样交给 xterm
    data class TermReady(val sid: String) : ServerFrame
    data class TermData(val sid: String, val d: String) : ServerFrame
    data class TermClose(val sid: String, val reason: String?) : ServerFrame
    /** 插件放行, 启用, 停用, 撤销, 换版本; change 原样交给上层。 */
    data class PluginUpdate(val id: String, val change: String) : ServerFrame
}

data class PresenceEntry(val id: String, val name: String, val until: Long)

data class MetricPoint(val ts: Long, val values: Map<String, Double>)

/** 主机卡片: 探针每 10 分钟的快照, online=false 时 seen 为最后在线时间。 */
data class HostCard(
    val subject: String,
    val online: Boolean,
    val seen: Long,
    val hostname: String?,
    val ip: String?,
    val os: String?,
    val arch: String?,
    val cores: Int?,
    val memTotal: Double?,
    val diskTotal: Double?,
    val bootAt: Long?,
    val last: MetricPoint?,
    val avail: Double?,
    /** 探针本机开了终端且 key 有 probe:shell 权限。 */
    val shell: Boolean = false,
    /** 心跳条: 每格 24 分钟, 从旧到新 (g/y/r/n), 最后一格截至 beatsAt。 */
    val beats: String? = null,
    val beatsAt: Long? = null,
)

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
            "welcome" -> ServerFrame.Welcome(o.optLong("head"), o.optInt("v"), o.optLong("now"), o.optString("session").ifEmpty { null }, o.optBoolean("resync"), o.optLong("floor"), o.optString("uid").ifEmpty { null }, o.optJSONObject("user")?.optString("display")?.ifEmpty { null }, o.optJSONObject("compat")?.let { Compat(it.optString("level"), it.optString("msg").ifEmpty { null }) })
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
            "hosts" -> ServerFrame.Hosts(parseHosts(o.optJSONArray("hosts") ?: JSONArray()))
            T_EV -> ServerFrame.Ev(V1Decode.envelope(o.getJSONObject(T_EV)))
            T_TASK -> ServerFrame.Task(V1Decode.task(o.getJSONObject(T_TASK)))
            "act_ok" -> ServerFrame.ActOk(o.getString(KEY_AID), o.optString("state"))
            T_OVERVIEW -> o.getJSONObject(T_OVERVIEW).let { ServerFrame.OverviewFrame(V1Decode.overview(it), it.toString()) }
            "space_update" -> ServerFrame.SpaceUpdate(o.optString("id"), o.optBoolean("deleted"), o.toString())
            "settings" -> ServerFrame.Settings(o.optJSONObject("settings")?.toString() ?: "{}")
            "chat_sync" -> ServerFrame.ChatSync(o.optString("topic"), o.optString("channel").ifEmpty { null })
            "pdata_sync" -> ServerFrame.PDataSync(o.optString("plugin"), o.optString("coll"), o.optLong("rev"))
            "presence" -> ServerFrame.Presence(o.optString("channel"), presence(o.optJSONArray("listening")), presence(o.optJSONArray("typing")))
            "agents" -> ServerFrame.Agents(V1Decode.agents(o.optJSONArray("agents")))
            "task_log" -> o.getJSONObject("entry").let { e ->
                ServerFrame.TaskLog(o.getString("taskId"), e.optString("role"), e.optString("kind"), e.optString(KEY_TEXT).ifEmpty { null }, e.optLong(KEY_TS))
            }
            "term_ready" -> ServerFrame.TermReady(o.getString(KEY_SID))
            "term" -> ServerFrame.TermData(o.getString(KEY_SID), o.getString("d"))
            "term_close" -> ServerFrame.TermClose(o.getString(KEY_SID), o.optString("reason").ifEmpty { null })
            "plugin_update" -> ServerFrame.PluginUpdate(o.optString("id"), o.optString("change"))
            else -> null
        }
    }

    private fun presence(arr: JSONArray?): List<PresenceEntry> = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
        arr!!.optJSONObject(i)?.let { PresenceEntry(it.optString("id"), it.optString("name"), it.optLong("until")) }
    }

    private fun parseMetric(o: JSONObject): ServerFrame.Metric {
        val arr = o.optJSONArray(KEY_POINTS) ?: JSONArray()
        val points = (0 until arr.length()).map { i -> point(arr.getJSONObject(i)) }
        return ServerFrame.Metric(o.optString("subject"), points, o.optBoolean("history"))
    }

    private fun point(p: JSONObject): MetricPoint {
        val v = p.getJSONObject("values")
        return MetricPoint(p.getLong(KEY_TS), v.keys().asSequence().associateWith { v.getDouble(it) })
    }

    private fun parseHosts(arr: JSONArray): List<HostCard> = (0 until arr.length()).mapNotNull { i ->
        val h = arr.optJSONObject(i) ?: return@mapNotNull null
        val info = h.optJSONObject("info") ?: JSONObject()
        fun str(k: String) = info.optString(k).ifEmpty { null }
        fun num(k: String) = if (info.has(k)) info.optDouble(k) else null
        HostCard(
            subject = h.optString("subject"),
            online = h.optBoolean("online"),
            seen = h.optLong("seen"),
            hostname = str("hostname"),
            ip = str("ip"),
            os = str("os"),
            arch = str("arch"),
            cores = num("cores")?.toInt(),
            memTotal = num("memTotal"),
            diskTotal = num("diskTotal"),
            bootAt = num("bootAt")?.toLong(),
            last = h.optJSONObject("last")?.let { runCatching { point(it) }.getOrNull() },
            avail = if (h.has("avail")) h.optDouble("avail") else null,
            shell = info.optBoolean("shell"),
            beats = h.optString("beats").ifEmpty { null },
            beatsAt = if (h.has("beatsAt")) h.optLong("beatsAt") else null,
        )
    }

    /** 声明当前在看的主体, 空列表表示不看了; 页面离开或进入后台时必须发空列表。 */
    fun watch(subjects: List<String>): String = JSONObject().put(KEY_T, "watch").put("subjects", JSONArray(subjects)).toString()

    /** 发消息: channel 为目标群 (备忘不写), reply / fwd 为被引用 / 被转发消息的 seq。 */
    fun send(cid: String, text: String, channel: String? = null, reply: Long? = null, fwd: Long? = null, file: String? = null): String {
        val o = JSONObject()
            .put(KEY_T, "send")
            .put(KEY_CID, cid)
            .put(KEY_BODY, JSONObject().put(KEY_KIND, KIND_TEXT).put(KEY_TEXT, text))
        channel?.let { o.put("channel", it) }
        reply?.let { o.put("reply", it) }
        fwd?.let { o.put("fwd", it) }
        file?.let { o.put("file", it) }
        return o.toString()
    }

    /** 开终端会话: ticket 是输入密码换来的 60 秒票据。 */
    fun termOpen(sid: String, subject: String, ticket: String, cols: Int, rows: Int): String =
        JSONObject().put(KEY_T, "term_open").put(KEY_SID, sid).put("subject", subject).put("ticket", ticket).put(KEY_COLS, cols).put(KEY_ROWS, rows).toString()

    fun term(sid: String, b64: String): String = JSONObject().put(KEY_T, "term").put(KEY_SID, sid).put("d", b64).toString()

    fun termResize(sid: String, cols: Int, rows: Int): String =
        JSONObject().put(KEY_T, "term_resize").put(KEY_SID, sid).put(KEY_COLS, cols).put(KEY_ROWS, rows).toString()

    fun termClose(sid: String): String = JSONObject().put(KEY_T, "term_close").put(KEY_SID, sid).toString()

    fun typing(channel: String): String = JSONObject().put(KEY_T, "typing").put("channel", channel).toString()

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

/** 握手档位: ok 兼容, update 建议更新, floor 低于支持窗口 (新功能灰掉), blocked 被拒。 */
data class Compat(val level: String, val msg: String?) {
    val limited get() = level == "floor" || level == "blocked"
}
