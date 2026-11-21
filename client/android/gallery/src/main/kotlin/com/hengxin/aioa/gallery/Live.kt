package com.hengxin.aioa.gallery

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.WebSocket
import java.util.concurrent.CompletionStage

private const val ENV_SERVER = "AIOA_SERVER"
private const val ENV_TOKEN = "AIOA_TOKEN"
private const val ENV_SUBJECT = "AIOA_SUBJECT"
private const val DEVICE = "gallery"
private const val KEEP_POINTS = 120

/** 一个时间点的多项指标。 */
data class Sample(val ts: Long, val values: Map<String, Float>)

/** 实时指标: 打开页面时 watch, 关闭时取消, 服务端据此让探针开始 / 停止推送。 */
class LiveFeed(val subject: String) {
    val samples = mutableStateOf<List<Sample>>(emptyList())
    val connected = mutableStateOf(false)
    fun series(key: String): List<Float> = samples.value.mapNotNull { it.values[key] }
    fun last(key: String): Float? = samples.value.lastOrNull()?.values?.get(key)
}

/** 设置了 AIOA_SERVER / AIOA_TOKEN 时连真服务器, 否则返回 null, 页面继续用模拟数据。 */
@Composable
fun rememberLive(): LiveFeed? {
    val server = System.getenv(ENV_SERVER) ?: return null
    val token = System.getenv(ENV_TOKEN) ?: return null
    val subject = System.getenv(ENV_SUBJECT) ?: return null
    val feed = remember(server, subject) { LiveFeed(subject) }
    DisposableEffect(feed) {
        val ws = open(server, token, feed)
        onDispose {
            ws?.sendText(watch(emptyList()), true)
            ws?.sendClose(WebSocket.NORMAL_CLOSURE, "")
        }
    }
    return feed
}

private fun watch(subjects: List<String>) = JSONObject().put("t", "watch").put("subjects", JSONArray(subjects)).toString()

private fun open(server: String, token: String, feed: LiveFeed): WebSocket? {
    val base = server.replaceFirst("http", "ws").trimEnd('/')
    val uri = URI("$base/ws?token=${URLEncoder.encode(token, Charsets.UTF_8)}&device=$DEVICE")
    val buffer = StringBuilder()
    val listener = object : WebSocket.Listener {
        override fun onOpen(ws: WebSocket) {
            feed.connected.value = true
            ws.sendText(watch(listOf(feed.subject)), true)
            ws.request(1)
        }

        override fun onText(ws: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
            buffer.append(data)
            if (last) {
                onFrame(buffer.toString(), feed)
                buffer.setLength(0)
            }
            ws.request(1)
            return null
        }

        override fun onClose(ws: WebSocket, code: Int, reason: String): CompletionStage<*>? {
            feed.connected.value = false
            return null
        }

        override fun onError(ws: WebSocket, error: Throwable) {
            feed.connected.value = false
        }
    }
    return runCatching { HttpClient.newHttpClient().newWebSocketBuilder().buildAsync(uri, listener).join() }.getOrNull()
}

private fun onFrame(raw: String, feed: LiveFeed) {
    val o = runCatching { JSONObject(raw) }.getOrNull() ?: return
    if (o.optString("t") != "metric" || o.optString("subject") != feed.subject) return
    val pts = o.optJSONArray("points") ?: return
    val incoming = (0 until pts.length()).map { i ->
        val p = pts.getJSONObject(i)
        val v = p.getJSONObject("values")
        Sample(p.getLong("ts"), v.keySet().associateWith { v.getDouble(it).toFloat() })
    }
    val merged = if (o.optBoolean("history")) incoming else feed.samples.value + incoming
    feed.samples.value = merged.takeLast(KEEP_POINTS)
}
