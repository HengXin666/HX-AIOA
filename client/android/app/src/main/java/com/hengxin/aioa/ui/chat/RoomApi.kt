package com.hengxin.aioa.ui.chat

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** 多人群成员。 */
data class RoomMember(val id: String, val name: String, val display: String, val role: String)

/** 邀请: link 给浏览器, appLink 由 App 直接接住。 */
data class RoomInvite(val code: String, val link: String, val appLink: String, val expires: Long)

/** 多人群的成员与邀请接口。 */
class RoomApi(private val context: Context) {

    suspend fun members(channel: String): Result<List<RoomMember>> = io {
        val r = Api.call(context, GET, listOf(Constants.CHATS_API, channel, MEMBERS))
        val arr = r.body?.optJSONArray(MEMBERS) ?: error(r.error ?: FAILED)
        (0 until arr.length()).mapNotNull { i ->
            arr.optJSONObject(i)?.let { RoomMember(it.optString("id"), it.optString("name"), it.optString("display").ifEmpty { it.optString("name") }, it.optString("role")) }
        }
    }

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
        private const val FAILED = "操作失败"
        private val CODE_RE = Regex("hxr_[A-Za-z0-9_-]+")

        /** 从链接或粘贴的文字里取出群邀请码。 */
        fun codeOf(input: String): String? = CODE_RE.find(input)?.value
    }
}
