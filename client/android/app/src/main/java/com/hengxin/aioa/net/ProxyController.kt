package com.hengxin.aioa.net

import android.content.Context
import com.hengxin.aioa.Constants
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.Proxy
import java.util.concurrent.TimeUnit

// mihomo external-controller 的最小封装, 只走本机回环, 不经过代理
class ProxyController(context: Context) {

    private val secret = ProxyCore.secret(context)
    private val client = OkHttpClient.Builder()
        .proxy(Proxy.NO_PROXY)
        .readTimeout(Constants.PROXY_TEST_TIMEOUT_MS * 2L, TimeUnit.MILLISECONDS)
        .build()

    // 并发测试分组内全部节点, 返回 节点名 -> 延迟毫秒, 超时的节点不在结果里
    fun groupDelay(): Map<String, Int> {
        val url = base().addPathSegment("group").addPathSegment(Constants.PROXY_GROUP).addPathSegment("delay")
            .addQueryParameter("url", Constants.PROXY_TEST_URL)
            .addQueryParameter("timeout", Constants.PROXY_TEST_TIMEOUT_MS.toString())
            .build()
        val json = call(Request.Builder().url(url).get()) ?: return emptyMap()
        return json.keys().asSequence().associateWith { json.optInt(it) }.filterValues { it > 0 }
    }

    // 订阅解析出的全部节点, 带最近一次测速结果 (0 表示未测或超时)
    fun nodes(): List<NodeInfo> {
        val url = base().addPathSegment("providers").addPathSegment("proxies").addPathSegment(PROVIDER).build()
        val list = call(Request.Builder().url(url).get())?.optJSONArray("proxies") ?: return emptyList()
        return (0 until list.length()).map { i ->
            val o = list.getJSONObject(i)
            val history = o.optJSONArray("history")
            val delay = if (history != null && history.length() > 0) history.getJSONObject(history.length() - 1).optInt("delay") else 0
            NodeInfo(o.optString("name"), o.optString("type"), delay)
        }
    }

    // 让内核立刻重新下载订阅
    fun refreshSubscription(): Boolean = send(
        Request.Builder()
            .url(base().addPathSegment("providers").addPathSegment("proxies").addPathSegment(PROVIDER).build())
            .put("".toRequestBody(JSON)),
    )

    fun current(): String? = call(Request.Builder().url(groupUrl()).get())?.optString("now")?.ifEmpty { null }

    fun select(name: String): Boolean = send(
        Request.Builder().url(groupUrl()).put(JSONObject().put("name", name).toString().toRequestBody(JSON)),
    )

    fun reload(configPath: String): Boolean = send(
        Request.Builder()
            .url(base().addPathSegment("configs").addQueryParameter("force", "true").build())
            .put(JSONObject().put("path", configPath).toString().toRequestBody(JSON)),
    )

    private fun groupUrl(): HttpUrl = base().addPathSegment("proxies").addPathSegment(Constants.PROXY_GROUP).build()

    private fun base(): HttpUrl.Builder = HttpUrl.Builder()
        .scheme("http")
        .host(Constants.LOOPBACK)
        .port(Constants.PROXY_CONTROLLER_PORT)

    private fun call(builder: Request.Builder): JSONObject? = runCatching {
        client.newCall(builder.header(AUTH, "Bearer $secret").build()).execute().use { resp ->
            if (!resp.isSuccessful) null else JSONObject(resp.body?.string().orEmpty())
        }
    }.getOrNull()

    private fun send(builder: Request.Builder): Boolean = runCatching {
        client.newCall(builder.header(AUTH, "Bearer $secret").build()).execute().use { it.isSuccessful }
    }.getOrDefault(false)

    companion object {
        const val PROVIDER = "sub"
        private const val AUTH = "Authorization"
        private val JSON = "application/json".toMediaType()
    }
}

data class NodeInfo(val name: String, val type: String, val delayMs: Int)
