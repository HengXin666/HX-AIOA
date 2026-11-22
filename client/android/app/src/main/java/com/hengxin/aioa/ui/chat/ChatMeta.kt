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
)

/** 群里接入的 Agent; brief 是怎么使唤它, reads 是它能读的群。 */
data class ChatAgent(val keyId: String, val name: String, val brief: String, val reads: List<String>, val created: Long, val rotated: Long?)

/** 收藏: 消息快照。 */
data class Favorite(val seq: Long, val saved: Long, val msg: ServerFrame.Msg)

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
    brief = o.optString("brief"),
    reads = strings(o.optJSONArray("reads")),
    created = o.optLong("created"),
    rotated = if (o.has("rotated")) o.optLong("rotated") else null,
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
            )
        }.getOrNull()
    }.associateBy { it.channel }
}

fun parseFavorites(body: JSONObject?): List<Favorite> {
    val arr = body?.optJSONArray("favorites") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        runCatching { Favorite(o.getLong("seq"), o.optLong("saved"), V1Decode.envelope(o.getJSONObject("ev")).toMsg()) }.getOrNull()
    }
}
