package com.hengxin.aioa.ui.chat

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.ApiCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * 多人群成员; avatar 是头像 id (#130), joined 为入群时间 (群主为 0)。
 * 在线不在这里: 服务端成员列表不带, 一律看长连接 online 帧 (PeopleOnline) (#139)。
 */
data class RoomMember(val id: String, val name: String, val display: String, val role: String, val avatar: String? = null, val joined: Long = 0)

/** 成员一页 (#130): next 为下一页游标, 旧服务端不分页时为空。 */
data class MemberPage(val members: List<RoomMember>, val next: String?)

fun parseMember(o: JSONObject): RoomMember = RoomMember(
    o.optString("id"),
    o.optString("name"),
    o.optString("display").ifEmpty { o.optString("name") },
    o.optString("role"),
    o.optString("avatar").takeIf { !o.isNull("avatar") && it.isNotEmpty() },
    o.optLong("joined"),
)

fun parseMemberPage(b: JSONObject): MemberPage {
    val arr = b.optJSONArray("members")
    val list = (0 until (arr?.length() ?: 0)).mapNotNull { i -> arr?.optJSONObject(i)?.let(::parseMember) }
    return MemberPage(list, b.optString("next").takeIf { !b.isNull("next") && it.isNotEmpty() })
}

/** 邀请: link 给浏览器, appLink 由 App 直接接住。 */
data class RoomInvite(val code: String, val link: String, val appLink: String, val expires: Long)

/** 多人群的成员与邀请接口。 */
class RoomApi(private val context: Context) {

    /** 第一页成员 (@ 选择等只要前几十个的地方用)。 */
    suspend fun members(channel: String): Result<List<RoomMember>> = page(channel).map { it.members }

    /** 分页取成员 (#130); 第一页且不搜索时带 ETag 走磁盘缓存, 没变就是 304。 */
    suspend fun page(channel: String, cursor: String? = null, q: String? = null, limit: Int = PAGE_SIZE): Result<MemberPage> = io {
        val query = buildMap {
            put("limit", limit.toString())
            cursor?.let { put("cursor", it) }
            q?.trim()?.takeIf { it.isNotEmpty() }?.let { put("q", it) }
        }
        val segs = listOf(Constants.CHATS_API, channel, MEMBERS)
        val body = if (cursor == null && q.isNullOrBlank()) {
            ApiCache.refresh(context, cacheName(channel), segs, query).let { it.body ?: error(it.error ?: FAILED) }
        } else Api.call(context, GET, segs, query = query).let { it.body ?: error(it.error ?: FAILED) }
        parseMemberPage(body)
    }

    /** 上次缓存的第一页, 打开页面先显示。后台线程调用。 */
    fun cached(channel: String): MemberPage? = ApiCache.read(context, cacheName(channel))?.let(::parseMemberPage)

    private fun cacheName(channel: String) = "room-members-" + channel.replace(UNSAFE, "_")

    suspend fun invite(channel: String): Result<RoomInvite> = io {
        val r = Api.call(context, POST, listOf(Constants.CHATS_API, channel, INVITES), JSONObject())
        val b = r.body ?: error(r.error ?: FAILED)
        RoomInvite(b.getString("code"), b.optString("link"), b.optString("appLink"), b.optLong("expires"))
    }

    suspend fun setRole(channel: String, uid: String, role: String): Result<Unit> = io {
        val r = Api.call(context, PATCH, listOf(Constants.CHATS_API, channel, MEMBERS, uid), JSONObject().put("role", role))
        if (r.body == null) error(r.error ?: FAILED)
    }

    /** 踢人; uid 是自己时就是退群。 */
    suspend fun remove(channel: String, uid: String): Result<Unit> = io {
        val r = Api.call(context, DELETE, listOf(Constants.CHATS_API, channel, MEMBERS, uid))
        if (r.body == null) error(r.error ?: FAILED)
    }

    /** 和 uid 的共同群 (#139, 资料卡): channel 列表, 不含单聊。 */
    suspend fun commonRooms(uid: String): Result<List<String>> = io {
        val r = Api.call(context, GET, listOf(USERS, uid, ROOMS))
        val arr = (r.body ?: error(r.error ?: FAILED)).optJSONArray(ROOMS_KEY)
        (0 until (arr?.length() ?: 0)).mapNotNull { arr?.optString(it)?.ifEmpty { null } }
    }

    /** 用邀请码或整条链接进群, 返回群的 channel。 */
    suspend fun join(input: String): Result<String> = io {
        val code = codeOf(input) ?: error("没找到邀请码")
        val r = Api.call(context, POST, listOf(JOIN), JSONObject().put("code", code))
        r.body?.optJSONObject("chat")?.optString("channel")?.ifEmpty { null } ?: error(r.error ?: FAILED)
    }

    private suspend fun <T> io(block: () -> T): Result<T> = withContext(Dispatchers.IO) { runCatching(block) }

    companion object {
        private const val GET = "GET"
        private const val POST = "POST"
        private const val PATCH = "PATCH"
        private const val DELETE = "DELETE"
        private const val MEMBERS = "members"
        private const val INVITES = "invites"
        private const val JOIN = "api/v1/rooms/join"
        private const val USERS = "api/v1/users"
        private const val ROOMS = "rooms"
        private const val ROOMS_KEY = "channels"
        private const val FAILED = "操作失败"
        const val PAGE_SIZE = 50
        private val UNSAFE = Regex("[^A-Za-z0-9_-]")
        private val CODE_RE = Regex("hxr_[A-Za-z0-9_-]+")

        /** 从链接或粘贴的文字里取出群邀请码。 */
        fun codeOf(input: String): String? = CODE_RE.find(input)?.value
    }
}
