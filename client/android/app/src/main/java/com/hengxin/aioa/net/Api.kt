package com.hengxin.aioa.net

import android.content.Context
import com.hengxin.aioa.config.Auth
import com.hengxin.aioa.config.ConfigStore
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/** 一次 REST 调用的结果: 成功时 body 非空, 失败时 error 是给人看的原因。 */
class ApiReply(val body: JSONObject?, val error: String?)

/** 带 token 调服务端 REST 接口, 失败时带回服务端的中文报错。只能在后台线程调用。 */
object Api {
    private const val JSON_TYPE = "application/json"

    fun call(
        context: Context,
        method: String,
        segments: List<String>,
        body: JSONObject? = null,
        query: Map<String, String> = emptyMap(),
    ): ApiReply {
        val config = ConfigStore.load(context) ?: return ApiReply(null, "还没有配置服务端")
        val b = runCatching { config.server.toHttpUrl().newBuilder() }.getOrNull() ?: return ApiReply(null, "服务端地址无效")
        segments.forEachIndexed { i, s -> if (i == 0) b.addPathSegments(s) else b.addPathSegment(s) }
        query.forEach { (k, v) -> b.addQueryParameter(k, v) }
        val req = Request.Builder().url(b.build())
            .header("Authorization", "Bearer ${Auth.bearer(context, config)}")
            .method(method, body?.toString()?.toRequestBody(JSON_TYPE.toMediaType()))
            .build()
        return runCatching {
            Net.client(context).newCall(req).execute().use { res ->
                val json = runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull()
                if (res.isSuccessful) ApiReply(json ?: JSONObject(), null)
                else ApiReply(null, json?.optString("error")?.ifEmpty { null } ?: "请求失败 (HTTP ${res.code})")
            }
        }.getOrElse { ApiReply(null, "网络错误: ${it.message ?: it.javaClass.simpleName}") }
    }
}
