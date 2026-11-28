package com.hengxin.aioa.ui.drive

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.ErrKind
import com.hengxin.aioa.net.Net
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

internal const val DRIVE_API = "api/v1/drive"
private const val HEADER_PASS = "X-Aioa-Drive"
private const val JSON_TYPE = "application/json"
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_NOT_MODIFIED = 304
private const val HTTP_UNAVAILABLE = 503
private const val PREFS = "drive"
// 通行证提前 5 分钟换新, 免得请求半路过期
private const val PASS_MARGIN_MS = 5 * 60_000L
private const val RECHECK_MS = 24 * 3600_000L
private const val CACHE_DIR = "drive-cache"
private const val GET = "GET"
private const val POST = "POST"
private const val DELETE = "DELETE"

/** 网盘请求的失败: code 为 HTTP 状态, apiCode 为服务端的 code (如 need_upload)。 */
class DriveError(message: String, val code: Int = 0, val apiCode: String? = null) : Exception(message) {
    // 429 / 503 时服务端给的等待秒数
    var retryAfter: Long? = null
    val kind: ErrKind get() = if (code > 0) ErrKind.of(code) else ErrKind.guess(message.orEmpty())
}

/**
 * 网盘是否可用与通行证 (#154): 通行证由主 Hub 签 (1 小时), 之后的网盘请求 Worker 自己验, 不进 DO。
 * 可用与否记在本机, 下次打开先按上次的显示; null 是还没问过。
 */
object DriveGate {
    var on by mutableStateOf<Boolean?>(null)
        private set
    var root by mutableStateOf("/")
        private set
    var whole by mutableStateOf(true)
        private set
    private var pass: String? = null
    private var expires = 0L
    private var loaded = false
    private val lock = Mutex()

    fun load(context: Context) {
        if (loaded) return
        loaded = true
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        on = if (p.contains("on")) p.getBoolean("on", false) else null
        root = p.getString("root", "/") ?: "/"
        whole = p.getBoolean("whole", true)
        pass = p.getString("pass", null)
        expires = p.getLong("expires", 0)
    }

    /** 当前可用的通行证; 快过期或 force 时向主 Hub 换一张。 */
    suspend fun pass(context: Context, force: Boolean = false): String = lock.withLock {
        load(context)
        val cur = pass
        if (!force && cur != null && expires - System.currentTimeMillis() > PASS_MARGIN_MS) return cur
        val r = withContext(Dispatchers.IO) { Api.call(context, POST, listOf("$DRIVE_API/pass")) }
        val b = r.body
        if (b == null) {
            if (r.code == HTTP_UNAVAILABLE || r.code == HTTP_FORBIDDEN) save(context, false)
            throw DriveError(r.error ?: "换不到网盘通行证", r.code)
        }
        pass = b.optString("pass")
        expires = b.optLong("expires")
        root = b.optString("root", "/")
        whole = b.optBoolean("whole", true)
        save(context, true)
        pass!!
    }

    /**
     * 连上时按需问一次: 没问过, 或上次不可用且已过一天 (服务端后来才接入 Drive) 时换一次通行证;
     * 能换到即可用, 没接入 (503) 或不是主人 (403) 即不可用, 断网不动状态。可用时不问, 用的时候才换。
     */
    suspend fun maybeProbe(context: Context) {
        load(context)
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val stale = System.currentTimeMillis() - p.getLong("probed", 0) > RECHECK_MS
        if (on == true || (on == false && !stale)) return
        p.edit().putLong("probed", System.currentTimeMillis()).apply()
        runCatching { pass(context, force = true) }
    }

    private fun save(context: Context, value: Boolean) {
        on = value
        if (!value) pass = null
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("on", value).putString("root", root).putBoolean("whole", whole)
            .putString("pass", pass).putLong("expires", expires).apply()
    }
}

/** 一次列目录的结果: changed 为 false 表示和缓存一样 (304)。 */
class Listing(val items: List<DriveNode>, val changed: Boolean)

/** 网盘接口; 都在 IO 线程跑, 失败抛 [DriveError]。接口见 docs/features/drive.md。 */
class DriveApi(context: Context) {
    private val app = context.applicationContext

    /** 发一次请求; 通行证失效 (401) 时换一张再试一次。 */
    internal suspend fun <T> send(method: String, sub: String, query: Map<String, String> = emptyMap(), body: RequestBody? = null, headers: Map<String, String> = emptyMap(), read: (okhttp3.Response) -> T): T = withContext(Dispatchers.IO) {
        val base = ConfigStore.load(app)?.server ?: throw DriveError("还没有配置服务端")
        var force = false
        var out: T
        while (true) {
            val pass = DriveGate.pass(app, force)
            val url = base.toHttpUrl().newBuilder().addPathSegments(DRIVE_API).addPathSegments(sub.trimStart('/')).apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
            val req = Request.Builder().url(url).header(HEADER_PASS, pass).apply { headers.forEach { (k, v) -> header(k, v) } }
                .method(method, body ?: if (method == POST) "{}".toRequestBody(JSON_TYPE.toMediaType()) else null).build()
            val res = runCatching { Net.client(app).newCall(req).execute() }.getOrElse { throw DriveError(ErrKind.describe(it)) }
            if (res.code == HTTP_UNAUTHORIZED && !force) {
                res.close()
                force = true
                continue
            }
            out = res.use(read)
            break
        }
        out
    }

    private suspend fun json(method: String, sub: String, body: JSONObject? = null, query: Map<String, String> = emptyMap()): JSONObject =
        send(method, sub, query, body?.toString()?.toRequestBody(JSON_TYPE.toMediaType())) { res -> parse(res) }

    /** 本机缓存的目录列表; 没有返回 null。 */
    fun cached(path: String): List<DriveNode>? = runCatching { parseNodes(JSONObject(cacheFile(path).readText()).optJSONObject("body")?.optJSONArray("items")) }.getOrNull()

    /** 列目录: 带上次的 ETag, 没变回 304 时用缓存。 */
    suspend fun list(path: String): Listing {
        val f = cacheFile(path)
        val old = runCatching { JSONObject(f.readText()) }.getOrNull()
        val etag = old?.optString("etag").orEmpty()
        return send(GET, "list", mapOf("path" to path), headers = if (etag.isNotEmpty()) mapOf("If-None-Match" to etag) else emptyMap()) { res ->
            if (res.code == HTTP_NOT_MODIFIED && old != null) return@send Listing(parseNodes(old.optJSONObject("body")?.optJSONArray("items")), false)
            val b = parse(res)
            runCatching { f.writeText(JSONObject().put("etag", res.header("ETag").orEmpty()).put("body", b).toString()) }
            Listing(parseNodes(b.optJSONArray("items")), true)
        }
    }

    suspend fun search(q: String): List<DriveNode> = parseNodes(json(GET, "search", query = mapOf("q" to q)).optJSONArray("items"))
    suspend fun mkdir(path: String) { json(POST, "mkdir", JSONObject().put("path", path)) }
    suspend fun rename(id: String, name: String) { json(POST, "move", JSONObject().put("id", id).put("name", name)) }
    suspend fun move(id: String, toPath: String) { json(POST, "move", JSONObject().put("id", id).put("toPath", toPath)) }
    suspend fun delete(id: String) { json(POST, "delete", JSONObject().put("id", id)) }
    suspend fun trash(): List<DriveNode> = parseNodes(json(GET, "trash").optJSONArray("items"))
    suspend fun restore(id: String) { json(POST, "restore", JSONObject().put("id", id)) }
    suspend fun purge(id: String) { json(POST, "purge", JSONObject().put("id", id)) }
    suspend fun emptyTrash() { json(POST, "trash/empty") }
    suspend fun link(id: String): String = json(POST, "link", JSONObject().put("id", id)).optString("url")
    suspend fun manifest(id: String): JSONObject = json(GET, "manifest", query = mapOf("id" to id))
    suspend fun shares(): List<DriveShare> = parseShares(json(GET, "shares").optJSONArray("items"))
    suspend fun unshare(id: String) { json(DELETE, "shares/$id") }

    /** 新建分享, 返回链接; ttlSec 为 0 是永久。 */
    suspend fun share(id: String, ttlSec: Long, password: String): String {
        val b = JSONObject().put("id", id)
        if (ttlSec > 0) b.put("expiresIn", ttlSec)
        if (password.isNotEmpty()) b.put("password", password)
        return json(POST, "shares", b).optString("url")
    }

    suspend fun stats(): DriveStats? = json(GET, "stats").optJSONObject("stats")?.let { DriveStats(it.optLong("files"), it.optLong("dirs"), it.optLong("bytes")) }

    suspend fun initUpload(path: String, name: String, size: Long, mime: String): JSONObject =
        json(POST, "uploads", JSONObject().put("path", path).put("name", name).put("size", size).put("mime", mime))

    suspend fun commit(ticket: String, receipts: List<String>): JSONObject =
        json(POST, "commit", JSONObject().put("ticket", ticket).put("receipts", JSONArray(receipts)))

    /** 聊天文件存到网盘 (服务端复制); 要客户端自己上传时抛 apiCode = need_upload。返回存到的目录。 */
    suspend fun save(fileId: String, dir: String? = null): String = hub("save", JSONObject().put("file", fileId).apply { dir?.let { put("path", it) } }).optString("path")

    /** 网盘文件登记成聊天附件, 返回附件 id。 */
    suspend fun attach(id: String, channel: String?): String = hub("attach", JSONObject().put("id", id).apply { channel?.let { put("channel", it) } }).optJSONObject("file")?.optString("id")
        ?: throw DriveError("登记附件失败")

    private suspend fun hub(op: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val r = Api.call(app, POST, listOf("$DRIVE_API/$op"), body)
        r.body ?: throw DriveError(r.error ?: "请求失败", r.code, r.apiCode)
    }

    private fun parse(res: okhttp3.Response): JSONObject {
        val json = runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull()
        if (res.isSuccessful) return json ?: JSONObject()
        throw DriveError(json?.optString("error")?.ifEmpty { null } ?: "请求失败 (HTTP ${res.code})", res.code, json?.optString("code")?.ifEmpty { null })
    }

    private fun cacheFile(path: String): File {
        val dir = File(app.filesDir, CACHE_DIR).apply { mkdirs() }
        val h = MessageDigest.getInstance("SHA-1").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, "$h.json")
    }

    companion object {
        /** 清掉本机的目录缓存 (换服务端或令牌时)。 */
        fun clearCache(context: Context) {
            File(context.filesDir, CACHE_DIR).deleteRecursively()
        }
    }
}
