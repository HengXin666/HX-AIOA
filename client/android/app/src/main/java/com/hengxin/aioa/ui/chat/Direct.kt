package com.hengxin.aioa.ui.chat

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** 开单聊 (#133): POST /dms { peer } → 那一行群资料; 已有就是原来那个。 */
suspend fun openDirect(context: Context, peer: String): Result<ChatMeta> = withContext(Dispatchers.IO) {
    val r = Api.call(context, "POST", listOf(Constants.DMS_PATH), JSONObject().put("peer", peer))
    r.body?.optJSONObject("chat")?.let(::parseChat)?.let { Result.success(it) }
        ?: Result.failure(Exception(r.error ?: "服务端还不支持单聊"))
}
