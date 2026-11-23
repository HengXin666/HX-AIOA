package com.hengxin.aioa.ui.chat

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.V1Decode
import com.hengxin.aioa.proto.toMsg

/** 云端消息: 本地翻到头后按 seq 向前要一页; 撤回 / 删除留墓碑。只能在后台线程调用。 */
class ChatHistory(private val context: Context) {

    /** 群 key 里 before 之前最近 limit 条 (升序); 失败时返回空, 当作云端也没有更多。 */
    fun before(key: String, before: Long, limit: Int): List<ServerFrame.Msg> {
        val q = mapOf(QUERY_BEFORE to before.toString(), QUERY_LIMIT to limit.toString())
        val arr = Api.call(context, GET, listOf(Constants.CHATS_API, key, MESSAGES), query = q).body?.optJSONArray(MESSAGES) ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            runCatching { V1Decode.envelope(arr.getJSONObject(i)) }.getOrNull()?.takeIf { it.kind != Constants.KIND_METRIC }?.toMsg()
        }
    }

    /** mode: recall (2 分钟内自己发的) 或 delete; 成功返回墓碑。 */
    fun remove(seq: Long, mode: String): Result<ServerFrame.Msg> {
        val r = Api.call(context, DELETE, listOf(EVENTS_SEQ, seq.toString()), query = mapOf(QUERY_MODE to mode))
        val body = r.body ?: return Result.failure(Exception(r.error ?: "操作失败"))
        return runCatching { V1Decode.envelope(body).toMsg() }
    }

    private companion object {
        const val GET = "GET"
        const val DELETE = "DELETE"
        const val MESSAGES = "messages"
        const val EVENTS_SEQ = "api/v1/events/seq"
        const val QUERY_BEFORE = "before"
        const val QUERY_LIMIT = "limit"
        const val QUERY_MODE = "mode"
    }
}
