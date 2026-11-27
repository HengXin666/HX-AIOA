package com.hengxin.aioa.net

import android.content.Context
import com.hengxin.aioa.config.Auth
import com.hengxin.aioa.config.ConfigStore
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.io.File

/** 缓存优先: 先拿磁盘上的上一份立刻显示, 再带 ETag 去服务端问, 没变 (304) 就不动。 */
object ApiCache {
    private const val UPLOAD_TIMEOUT_SEC = 60L
    private const val UPLOAD_TRIES = 2
    private const val UPLOAD_CALL_SEC = 90L

    private const val DIR = "api-cache"
    private const val ETAG = "ETag"
    private const val IF_NONE_MATCH = "If-None-Match"
    private const val NOT_MODIFIED = 304
    private const val KEY_BODY = "body"
    private const val KEY_ETAG = "etag"

    /** 刷新结果: changed 为 false 表示和缓存一样, body 为 null 表示失败。 */
    class Fresh(val body: JSONObject?, val changed: Boolean, val error: String?, val code: Int = 0)

    private fun file(context: Context, name: String) = File(File(context.filesDir, DIR).apply { mkdirs() }, "$name.json")

    fun read(context: Context, name: String): JSONObject? =
        runCatching { JSONObject(file(context, name).readText()).optJSONObject(KEY_BODY) }.getOrNull()

    fun write(context: Context, name: String, body: JSONObject, etag: String? = null) {
        val f = file(context, name)
        val tmp = File(f.path + ".tmp")
        tmp.writeText(JSONObject().put(KEY_BODY, body).put(KEY_ETAG, etag ?: "").toString())
        tmp.renameTo(f)
    }

    private fun etagOf(context: Context, name: String): String? =
        runCatching { JSONObject(file(context, name).readText()).optString(KEY_ETAG).ifEmpty { null } }.getOrNull()

    /** 后台线程调用。服务端没给 ETag 时比较内容, 内容一样也算没变, 界面不重绘。 */
    fun refresh(context: Context, name: String, segments: List<String>, query: Map<String, String> = emptyMap()): Fresh {
        val url = urlOf(context, segments, query) ?: return Fresh(null, false, "还没有配置服务端")
        val config = ConfigStore.load(context) ?: return Fresh(null, false, "还没有配置服务端")
        val b = Request.Builder().url(url).header("Authorization", "Bearer ${Auth.bearer(context, config)}")
        etagOf(context, name)?.let { b.header(IF_NONE_MATCH, it) }
        return runCatching {
            Net.client(context).newCall(b.build()).execute().use { res ->
                if (res.code == NOT_MODIFIED) return@use Fresh(read(context, name), false, null, res.code)
                val text = res.body?.string().orEmpty()
                val json = runCatching { JSONObject(text) }.getOrNull()
                if (!res.isSuccessful || json == null) {
                    return@use Fresh(null, false, json?.optString("error")?.ifEmpty { null } ?: "请求失败 (HTTP ${res.code})", res.code)
                }
                val same = read(context, name)?.toString() == json.toString()
                if (!same) write(context, name, json, res.header(ETAG))
                Fresh(json, !same, null, res.code)
            }
        }.getOrElse { Fresh(null, false, "网络错误: ${it.message ?: it.javaClass.simpleName}") }
    }

    /**
     * 缓存优先的 GET (后台线程调用): 有缓存先回调一次 (fromCache = true), 再问服务端,
     * 内容变了才再回调; 返回错误信息, 成功为 null。页面因此二次打开不转圈, 没变化也不重绘。
     * onCode 收到服务端的 HTTP 状态码 (网络错误时为 0)。
     */
    suspend fun get(
        context: Context,
        name: String,
        segments: List<String>,
        query: Map<String, String> = emptyMap(),
        onCode: (Int) -> Unit = {},
        onBody: suspend (body: JSONObject, fromCache: Boolean) -> Unit,
    ): String? {
        read(context, name)?.let { onBody(it, true) }
        val fresh = refresh(context, name, segments, query)
        onCode(fresh.code)
        if (fresh.changed && fresh.body != null) onBody(fresh.body, false)
        return fresh.error
    }

    fun urlOf(context: Context, segments: List<String>, query: Map<String, String> = emptyMap()): HttpUrl? {
        val config = ConfigStore.load(context) ?: return null
        val b = runCatching { config.server.toHttpUrl().newBuilder() }.getOrNull() ?: return null
        segments.forEachIndexed { i, s -> if (i == 0) b.addPathSegments(s) else b.addPathSegment(s) }
        query.forEach { (k, v) -> b.addQueryParameter(k, v) }
        return b.build()
    }

    /** 取二进制 (头像), 失败返回 null。 */
    fun bytes(context: Context, segments: List<String>): ByteArray? {
        val url = urlOf(context, segments) ?: return null
        val config = ConfigStore.load(context) ?: return null
        val req = Request.Builder().url(url).header("Authorization", "Bearer ${Auth.bearer(context, config)}").build()
        return runCatching { Net.client(context).newCall(req).execute().use { if (it.isSuccessful) it.body?.bytes() else null } }.getOrNull()
    }

    /**
     * 上传二进制, 返回服务端 JSON。超时会重试, 只用于幂等的 PUT (头像按内容哈希命名, 重传结果相同)。
     * onProgress 报 (已发字节, 总字节), 重试时从 0 重报。
     */
    fun upload(context: Context, segments: List<String>, data: ByteArray, mime: String, onProgress: ((Long, Long) -> Unit)? = null): ApiReply {
        val url = urlOf(context, segments) ?: return ApiReply(null, "还没有配置服务端")
        val config = ConfigStore.load(context) ?: return ApiReply(null, "还没有配置服务端")
        val req = Request.Builder().url(url)
            .header("Authorization", "Bearer ${Auth.bearer(context, config)}")
            .put(data.toRequestBody(mime.toMediaType()).let { b -> onProgress?.let { CountingBody(b, it) } ?: b })
            .build()
        // 上传走代理或弱网时 OkHttp 默认 10 秒写超时不够 (#110 群头像上传超时), 放宽并在超时时重试一次
        val client = Net.client(context).newBuilder()
            .writeTimeout(UPLOAD_TIMEOUT_SEC, TimeUnit.SECONDS).readTimeout(UPLOAD_TIMEOUT_SEC, TimeUnit.SECONDS)
            .callTimeout(UPLOAD_CALL_SEC, TimeUnit.SECONDS).build()
        var last: ApiReply? = null
        repeat(UPLOAD_TRIES) {
            last = runCatching {
                client.newCall(req).execute().use { res ->
                    val json = runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull()
                    // 周报 (#140): 传成功的文件数与字节数, 只记在内存里
                    if (res.isSuccessful) ApiReply(json ?: JSONObject(), null).also { com.hengxin.aioa.data.LocalTally.add(com.hengxin.aioa.data.Tally.FILES); com.hengxin.aioa.data.LocalTally.add(com.hengxin.aioa.data.Tally.FILE_UP, data.size.toLong()) }
                    else ApiReply(null, json?.optString("error")?.ifEmpty { null } ?: "上传失败 (HTTP ${res.code})", res.code)
                }
            }.getOrElse { ApiReply(null, ErrKind.describe(it)) }
            if (last?.kind != ErrKind.TIMEOUT) return last!!
        }
        return last!!
    }
}
