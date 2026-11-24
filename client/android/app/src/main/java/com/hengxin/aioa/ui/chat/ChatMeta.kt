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
    /** 展示方式: 空为聊天, mail 为邮件列表。 */
    val view: String? = null,
    /** 群主 / 管理员关掉了 "正在监听" / "正在输入" 提示。 */
    val hideListening: Boolean = false,
    val hideTyping: Boolean = false,
    /** 群被删除的时间: 墓碑, 本地删记录并隐藏; 之后有新消息会重新出现。 */
    val deleted: Long = 0,
) {
    val isMail get() = view == VIEW_MAIL
    val shared get() = role != null
    val canManage get() = role == ROLE_OWNER || role == ROLE_ADMIN
    /** 自己的群 (没有 role) 也算能管。 */
    val canTune get() = role == null || canManage
    val configured get() = deleted == 0L && title != null || avatar != null || pinned || digest != null || agents.isNotEmpty() || role != null
}

/** 群里接入的 Agent; reads 是它能读的群, joined 是最近报到时间, pending 表示指令变了还没重新报到。 */
data class ChatAgent(val keyId: String, val name: String, val reads: List<String>, val created: Long, val rotated: Long?, val joined: Long?, val pending: Boolean)

/** 收藏: 按引用取到的原消息当前版本; gone 表示原消息已没了, msg 只剩收藏时的摘要。 */
data class Favorite(val seq: Long, val saved: Long, val msg: ServerFrame.Msg, val gone: Boolean = false)

const val VIEW_MAIL = "mail"

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
)

fun parseChats(body: JSONObject?): Map<String, ChatMeta> {
    val arr = body?.optJSONArray("chats") ?: return emptyMap()
    return (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        val agents = o.optJSONArray("agents")
        runCatching {
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
            )
        }.getOrNull()
    }.associateBy { it.channel }
}

fun parseFavorites(body: JSONObject?): List<Favorite> {
    val arr = body?.optJSONArray("favorites") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        runCatching { Favorite(o.getLong("seq"), o.optLong("saved"), V1Decode.envelope(o.getJSONObject("ev")).toMsg(), o.optBoolean("gone")) }.getOrNull()
    }
}
