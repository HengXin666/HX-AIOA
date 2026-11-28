package com.hengxin.aioa.ui.chat

import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.V1Decode
import com.hengxin.aioa.proto.toMsg
import org.json.JSONArray
import org.json.JSONObject

/** 群资料 (与服务端 ChatMeta 对应), 没设置过的群没有这一项。 */
data class ChatMeta(
    val channel: String,
    val title: String?,
    val avatar: String?,
    val pinned: Boolean,
    val muted: Boolean,
    val read: Long,
    val digest: String?,
    val agents: List<ChatAgent>,
    val updated: Long,
    /** 清空聊天记录的位置: seq <= cleared 的本地消息要删掉。 */
    val cleared: Long = 0,
    /** 多人群里我的身份 (owner / admin / member) 与人数; 只有自己的群为空。 */
    val role: String? = null,
    val members: Int = 0,
    /** 展示方式: 空为聊天, mail 为邮件列表, feed 为信息流。 */
    val view: String? = null,
    /** 群主 / 管理员关掉了 "正在监听" / "正在输入" 提示。 */
    val hideListening: Boolean = false,
    val hideTyping: Boolean = false,
    /** 群被删除的时间: 墓碑, 本地删记录并隐藏; 之后有新消息会重新出现。 */
    val deleted: Long = 0,
    /** 信息流标签表; 空为默认四类。 */
    val feedTags: List<com.hengxin.aioa.ui.feed.FeedTag> = emptyList(),
    /** 群公告 (#133), 群主 / 管理员可改。 */
    val notice: String? = null,
    /** dm 为真人单聊 (#133), peer 为对方 uid; 空为群。 */
    val kind: String? = null,
    val peer: String? = null,
) {
    val isDm get() = kind == KIND_DM
    val tags get() = feedTags.ifEmpty { com.hengxin.aioa.ui.feed.DEFAULT_TAGS }
    val isMail get() = view == VIEW_MAIL
    val isFeed get() = view == VIEW_FEED
    val shared get() = role != null
    val canManage get() = role == ROLE_OWNER || role == ROLE_ADMIN
    /** 自己的群 (没有 role) 也算能管。 */
    val canTune get() = role == null || canManage
    val configured get() = deleted == 0L && title != null || avatar != null || pinned || digest != null || agents.isNotEmpty() || role != null
}

const val KIND_DM = "dm"

/** 群里接入的 Agent; reads 是它能读的群, joined 是最近报到时间, pending 表示指令变了还没重新报到。 */
data class ChatAgent(
    val keyId: String,
    val name: String,
    val reads: List<String>,
    val created: Long,
    val rotated: Long?,
    val joined: Long?,
    val pending: Boolean,
    val sourceId: String? = null,
    val plugin: String? = null,
    /** 最近一次拉消息 / 发消息 / 拉指令的时间, 服务端最多每 10 分钟记一次。 */
    val active: Long? = null,
    /** skill 版 Agent: 处理游标与游标之后零散已处理的 seq; 旧 Agent 没有。 */
    val handled: Long? = null,
    val handledSet: List<Long> = emptyList(),
    /** 最近上报的已装版本; 服务端要求的接入版本, 大更新自动执行开关。 */
    val skills: com.hengxin.aioa.ui.agents.SkillReport? = null,
    val setup: Int? = null,
    val autoMajor: Boolean = false,
    val trigger: com.hengxin.aioa.ui.agents.AgentTrigger? = null,
    val lastRun: Long? = null,
    /** 已在群里提醒过的大版本缺失, 如 "hengxin666.todo@2:new"。 */
    val warned: List<String> = emptyList(),
    // 最近一次报到的客户端, 如 "hxaioa 0.4.1", 直接调接口为 "接口" (#139: 命令行版本在这里, 不在 skills 里)
    val client: String? = null,
)

/** 收藏: 按引用取到的原消息当前版本; gone 表示原消息已没了, msg 只剩收藏时的摘要。 */
data class Favorite(val seq: Long, val saved: Long, val msg: ServerFrame.Msg, val gone: Boolean = false)

/** 服务端系统通知群的 channel, 与 protocol 的 SYSTEM_CHANNEL 一致。 */
const val SYSTEM_CHANNEL = "system"

/**
 * 能不能往这个会话发消息 (#157, 转发与网盘发到群的选择列表): 邮件, 信息流, 系统通知, 已删除的群,
 * 以及不认识的展示方式都不列出; 没建过资料的普通群可以发。
 */
fun canPostTo(key: String, meta: ChatMeta?): Boolean =
    key != SYSTEM_CHANNEL && (meta == null || (meta.deleted == 0L && (meta.view == null || meta.view == VIEW_CHAT)))

const val VIEW_MAIL = "mail"
const val VIEW_FEED = "feed"
const val VIEW_CHAT = "chat"

const val ROLE_OWNER = "owner"
const val ROLE_ADMIN = "admin"
const val ROLE_MEMBER = "member"

const val DIGEST_DAILY = "daily"
const val DIGEST_WEEKLY = "weekly"

fun digestLabel(d: String?): String? = when (d) {
    DIGEST_DAILY -> "日报"
    DIGEST_WEEKLY -> "周报"
    else -> null
}

private fun JSONObject.optStr(k: String): String? = if (isNull(k)) null else optString(k).ifEmpty { null }

private fun strings(a: JSONArray?): List<String> = (0 until (a?.length() ?: 0)).mapNotNull { a?.optString(it)?.ifEmpty { null } }

fun parseAgent(o: JSONObject): ChatAgent = ChatAgent(
    keyId = o.getString("keyId"),
    name = o.optString("name"),
    reads = strings(o.optJSONArray("reads")),
    created = o.optLong("created"),
    rotated = if (o.has("rotated")) o.optLong("rotated") else null,
    joined = if (o.has("joined")) o.optLong("joined") else null,
    pending = o.optBoolean("pending"),
    sourceId = o.optStr("sourceId"),
    plugin = o.optStr("plugin"),
    active = optLongOrNull(o, "active"),
    handled = optLongOrNull(o, "handled"),
    handledSet = o.optJSONArray("handledSet")?.let { a -> (0 until a.length()).map { a.optLong(it) } }.orEmpty(),
    skills = com.hengxin.aioa.ui.agents.parseSkillReport(o.optJSONObject("skills")),
    setup = if (o.has("setup")) o.optInt("setup") else null,
    autoMajor = o.optBoolean("autoMajor"),
    trigger = com.hengxin.aioa.ui.agents.parseTrigger(o.optJSONObject("trigger")),
    lastRun = optLongOrNull(o, "lastRun"),
    warned = strings(o.optJSONArray("warned")),
    client = o.optStr("client"),
)

private fun optLongOrNull(o: JSONObject, k: String): Long? = if (o.has(k) && !o.isNull(k)) o.optLong(k) else null

fun parseChats(body: JSONObject?): Map<String, ChatMeta> {
    val arr = body?.optJSONArray("chats") ?: return emptyMap()
    return (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let(::parseChat) }.associateBy { it.channel }
}

/** 一行群资料; chat_sync 帧带的单行也走这里 (#129)。 */
fun parseChat(o: JSONObject): ChatMeta? {
    val agents = o.optJSONArray("agents")
    return runCatching {
        ChatMeta(
            channel = o.getString("channel"),
            title = o.optStr("title"),
            avatar = o.optStr("avatar"),
            pinned = o.optBoolean("pinned"),
            muted = o.optBoolean("muted"),
            read = o.optLong("read"),
            digest = o.optStr("digest"),
            agents = (0 until (agents?.length() ?: 0)).mapNotNull { j -> agents?.optJSONObject(j)?.let { runCatching { parseAgent(it) }.getOrNull() } },
            updated = o.optLong("updated"),
            cleared = o.optLong("cleared"),
            role = o.optStr("role"),
            members = o.optInt("members"),
            view = o.optStr("view"),
            hideListening = o.optBoolean("hideListening"),
            hideTyping = o.optBoolean("hideTyping"),
            deleted = o.optLong("deleted"),
            feedTags = com.hengxin.aioa.ui.feed.parseFeedTags(o.optJSONArray("feedTags")),
            notice = o.optStr("notice"),
            kind = o.optStr("kind"),
            peer = o.optStr("peer"),
        )
    }.getOrNull()
}

fun parseFavorites(body: JSONObject?): List<Favorite> {
    val arr = body?.optJSONArray("favorites") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        runCatching { Favorite(o.getLong("seq"), o.optLong("saved"), V1Decode.envelope(o.getJSONObject("ev")).toMsg(), o.optBoolean("gone")) }.getOrNull()
    }
}
