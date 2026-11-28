package com.hengxin.aioa.ui.drive

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.net.CountingBody
import com.hengxin.aioa.net.Net
import com.hengxin.aioa.net.TransferService
import com.hengxin.aioa.ui.chat.FileTransfer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** 一项传输: up 为上传; progress 0..1; error 非空为失败 (可重试); done 为完成。 */
data class Transfer(val key: String, val name: String, val dir: String, val up: Boolean, val progress: Float = 0f, val error: String? = null, val done: Boolean = false)

/**
 * 网盘的上传下载 (#154): 应用级单例, 离开页面也继续; 传输时起前台服务, 切到后台不被冻结。
 * 上传断点续传: Drive 的票据与每片回执存本机 (files/drive-up/), 24 小时内重来只补缺的片; 下载留 .part 按 Range 接着下。
 */
object DriveTransfers {
    val items = mutableStateListOf<Transfer>()
    // 有上传完成就加一, 页面据此刷新当前目录
    var finished by mutableIntStateOf(0)
        private set
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // 下载完接着做的事 (发到群这类) 跑在这里, 不跟着页面结束
    internal val ui = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val upLock = Mutex()
    private val uris = HashMap<String, Uri>()
    private const val UP_DIR = "drive-up"
    private const val DL_DIR = "drive"
    private const val TICKET_TTL_MS = 23 * 3600_000L
    private const val CHUNK_TRIES = 3
    private const val RETRY_SEC = 2L
    private const val RETRY_MAX_SEC = 60L
    private const val BUF = 64 * 1024
    private const val STEP = 0.02f
    private const val TITLE_UP = "网盘上传"
    private const val TITLE_DL = "网盘下载"
    private const val PERCENT = 100
    private const val RENAME_TRIES = 3
    private val links = HashMap<String, Pair<String, Long>>()
    private const val LINK_KEEP_MS = 5 * 3600_000L

    /** 多选上传到 dir: 排队一个个传。 */
    fun upload(context: Context, list: List<Uri>, dir: String) {
        val app = context.applicationContext
        for (uri in list) {
            val (name, size, _) = runCatching { FileTransfer.describe(app, uri) }.getOrElse { Triple("文件", -1L, "") }
            val key = sha1("$dir|$name|$size|$uri")
            uris[key] = uri
            items.removeAll { it.key == key }
            items.add(Transfer(key, name, dir, up = true))
            scope.launch { upLock.withLock { runUpload(app, key) } }
        }
    }

    fun retry(context: Context, t: Transfer) {
        if (!t.up || uris[t.key] == null) return
        update(t.key) { it.copy(error = null, progress = 0f) }
        scope.launch { upLock.withLock { runUpload(context.applicationContext, t.key) } }
    }

    fun dismiss(t: Transfer) {
        items.removeAll { it.key == t.key }
        if (t.up && t.error != null) uris.remove(t.key)
    }

    private fun update(key: String, f: (Transfer) -> Transfer) = scope.launch(Dispatchers.Main) {
        val i = items.indexOfFirst { it.key == key }
        if (i >= 0) items[i] = f(items[i])
    }

    private fun notify(context: Context, title: String, t: Transfer, p: Float) =
        TransferService.show(context, title, t.name, (p * PERCENT).toInt())

    private suspend fun runUpload(app: Context, key: String) {
        val t = withContext(Dispatchers.Main) { items.firstOrNull { it.key == key } } ?: return
        val uri = uris[key] ?: return
        val api = DriveApi(app)
        notify(app, TITLE_UP, t, 0f)
        val r = runCatching { uploadOne(app, api, key, uri, t) }
        r.onSuccess {
            update(key) { it.copy(progress = 1f, done = true) }
            uris.remove(key)
            withContext(Dispatchers.Main) { finished++ }
        }.onFailure { e -> update(key) { it.copy(error = e.message ?: "上传失败") } }
        finishIfIdle(app, key)
    }

    /** 除了刚结束的 key 没有别的在传时才停前台服务。 */
    private suspend fun finishIfIdle(app: Context, key: String) {
        if (withContext(Dispatchers.Main) { items.none { !it.done && it.error == null && it.key != key } }) TransferService.finish(app)
    }

    private suspend fun uploadOne(app: Context, api: DriveApi, key: String, uri: Uri, t: Transfer) {
        val (name, size, mime) = FileTransfer.describe(app, uri)
        if (size < 0) error("读不到文件大小")
        val state = File(File(app.filesDir, UP_DIR).apply { mkdirs() }, "$key.json")
        var s = runCatching { JSONObject(state.readText()) }.getOrNull()?.takeIf { System.currentTimeMillis() - it.optLong("at") < TICKET_TTL_MS }
        if (s == null) {
            val init = initWithRename(api, t.dir, name, size, mime)
            if (init.optBoolean("done")) {
                state.delete()
                return
            }
            s = JSONObject().put("ticket", init.getString("ticket")).put("chunkSize", init.getLong("chunkSize")).put("chunkCount", init.getInt("chunkCount"))
                .put("direct", init.optString("direct")).put("receipts", JSONObject()).put("folds", JSONObject()).put("at", System.currentTimeMillis())
            state.writeText(s.toString())
        }
        val ticket = s.getString("ticket")
        val chunkSize = s.getLong("chunkSize")
        val count = s.getInt("chunkCount")
        val receipts = s.getJSONObject("receipts")
        val folds = s.optJSONObject("folds") ?: JSONObject().also { s.put("folds", it) }
        // 直传 Drive 公网 (#157): 地址不通就这次上传剩下的片都退回 AIOA 转发
        val route = ChunkRoute(s.optString("direct").ifEmpty { null })
        var last = 0f
        for (i in UploadParts.pending(count, { folds.has(it.toString()) }, { receipts.has(it.toString()) })) {
            val off = i * chunkSize
            val len = minOf(chunkSize, size - off)
            val rc = putChunk(app, api, route, uri, ticket, i, off, len, mime) { sent ->
                val p = (off + sent).toFloat() / size.coerceAtLeast(1)
                if (p - last >= STEP) {
                    last = p
                    update(key) { it.copy(progress = p) }
                    notify(app, TITLE_UP, t, p)
                }
            }
            receipts.put(i.toString(), rc)
            if (UploadParts.needed(count)) fold(api, ticket, count, i / DRIVE_PART_SIZE, receipts, folds)
            state.writeText(s.toString())
        }
        // 上次停在 fold 之前的组补折一次; 折不了的组照样交零散回执
        if (UploadParts.needed(count)) for (g in 0 until UploadParts.groups(count)) fold(api, ticket, count, g, receipts, folds)
        state.writeText(s.toString())
        val groups = (0 until UploadParts.groups(count))
        try {
            api.commit(
                ticket,
                (0 until count).filter { !folds.has((it / DRIVE_PART_SIZE).toString()) }.map { receipts.getString(it.toString()) },
                groups.filter { folds.has(it.toString()) }.map { folds.getString(it.toString()) },
            )
        } catch (e: DriveError) {
            // 票据失效或回执不认: 下次从头传; 网络错误留着回执下次补
            if (e.code in HTTP_BAD..HTTP_CLIENT_MAX) state.delete()
            throw e
        }
        state.delete()
    }

    /** 第 g 组回执齐了且还没折叠时换成聚合回执, 换到后丢掉这组的零散回执; 失败不算错, 提交时交零散回执。 */
    private suspend fun fold(api: DriveApi, ticket: String, count: Int, g: Int, receipts: JSONObject, folds: JSONObject) {
        val k = g.toString()
        if (folds.has(k) || !UploadParts.full(g, count) { receipts.has(it.toString()) }) return
        val range = UploadParts.range(g, count)
        runCatching { api.fold(ticket, range.map { receipts.getString(it.toString()) }) }.onSuccess { f ->
            folds.put(k, f)
            range.forEach { receipts.remove(it.toString()) }
        }
    }

    /** 同名时自动改成 "名字 (1).扩展名" 再试, 最多 3 次。 */
    private suspend fun initWithRename(api: DriveApi, dir: String, name: String, size: Long, mime: String): JSONObject {
        var n = name
        repeat(RENAME_TRIES) { k ->
            try {
                return api.initUpload(dir, n, size, mime)
            } catch (e: DriveError) {
                if (e.code != HTTP_CONFLICT || e.apiCode == READONLY) throw e
                n = numbered(name, k + 1)
            }
        }
        return api.initUpload(dir, n, size, mime)
    }

    /** 这次上传的分片走哪: direct 为 Drive 公网分片地址 (只凭票据), null 为经 AIOA Worker 转发。 */
    private class ChunkRoute(@Volatile var direct: String?)

    private suspend fun putChunk(app: Context, api: DriveApi, route: ChunkRoute, uri: Uri, ticket: String, i: Int, off: Long, len: Long, mime: String, progress: (Long) -> Unit): String {
        var last: Exception? = null
        repeat(CHUNK_TRIES) { attempt ->
            val body = CountingBody(rangeBody(app, uri, off, len, mime)) { sent, _ -> progress(sent) }
            try {
                val direct = route.direct
                if (direct != null) {
                    try {
                        return directPut(app, direct, ticket, i, body)
                    } catch (e: DriveError) {
                        // 公网地址不通或不认 (网络错误, 被拦, 旧版): 改走转发, 这片立刻重传; 片本身的错照常处理
                        if (e.code != 0 && e.code !in DIRECT_FALLBACK) throw e
                        route.direct = null
                        return@repeat
                    }
                }
                return api.send("PUT", "chunk", mapOf("ticket" to ticket, "i" to i.toString()), body) { res -> receiptOf(res) }
            } catch (e: DriveError) {
                last = e
                val retriable = e.code == 0 || e.code == HTTP_TOO_MANY || e.code >= HTTP_SERVER
                if (!retriable || attempt == CHUNK_TRIES - 1) throw e
                delay((e.retryAfter ?: RETRY_SEC).coerceAtMost(RETRY_MAX_SEC) * 1000)
            }
        }
        // 最后一次在直传上失败并改走转发: 再转发一次
        if (last == null && route.direct == null) {
            val body = CountingBody(rangeBody(app, uri, off, len, mime)) { sent, _ -> progress(sent) }
            return api.send("PUT", "chunk", mapOf("ticket" to ticket, "i" to i.toString()), body) { res -> receiptOf(res) }
        }
        throw last ?: DriveError("上传失败")
    }

    /** 直传 Drive: 不带任何凭证, 只凭 URL 里的票据 (#157)。 */
    private suspend fun directPut(app: Context, url: String, ticket: String, i: Int, body: RequestBody): String = withContext(Dispatchers.IO) {
        val u = url.toHttpUrlOrNull()?.newBuilder()?.addQueryParameter("ticket", ticket)?.addQueryParameter("i", i.toString())?.build() ?: throw DriveError("直传地址不对")
        val res = runCatching { Net.client(app).newCall(Request.Builder().url(u).put(body).build()).execute() }.getOrElse { throw DriveError(it.message ?: "网络错误") }
        res.use(::receiptOf)
    }

    private fun receiptOf(res: okhttp3.Response): String {
        val text = res.body?.string().orEmpty()
        if (res.isSuccessful) return runCatching { JSONObject(text).getString("receipt") }.getOrElse { throw DriveError("上传失败 (回执不对)", HTTP_BAD_GATEWAY) }
        val msg = runCatching { JSONObject(text).optString("error") }.getOrNull()?.ifEmpty { null } ?: "上传失败 (HTTP ${res.code})"
        throw DriveError(msg, res.code).also { it.retryAfter = res.header("Retry-After")?.toLongOrNull() }
    }

    /** 文件的 [offset, offset + length) 一段作为请求体; 每次写出都重新打开, 重试时从头写这一段。 */
    private fun rangeBody(app: Context, uri: Uri, offset: Long, length: Long, mime: String) = object : RequestBody() {
        override fun contentType(): MediaType? = mime.toMediaTypeOrNull()
        override fun contentLength(): Long = length
        override fun writeTo(sink: BufferedSink) {
            com.hengxin.aioa.net.RangeInput.open(app, uri, offset).use { input ->
                val buf = ByteArray(BUF)
                var done = 0L
                while (done < length) {
                    val n = input.read(buf, 0, minOf(buf.size.toLong(), length - done).toInt())
                    if (n < 0) error("文件比登记的小")
                    sink.write(buf, 0, n)
                    done += n
                }
            }
        }
    }

    /** 本机已下载的副本, 没有返回 null。 */
    fun cached(context: Context, n: DriveNode): File? = target(context, n).takeIf { it.isFile && it.length() == n.size }

    private fun target(context: Context, n: DriveNode): File = File(File(context.filesDir, "$DL_DIR/${n.id}"), n.name.replace(UNSAFE, "_"))

    /** 签名直链 (6 小时), 按节点缓存 5 小时。 */
    suspend fun link(context: Context, n: DriveNode): String {
        links[n.id]?.let { (url, at) -> if (System.currentTimeMillis() - at < LINK_KEEP_MS) return url }
        val url = DriveApi(context).link(n.id)
        links[n.id] = url to System.currentTimeMillis()
        return url
    }

    /** 下到本机后执行 then (主线程); 已经有了直接执行。 */
    fun download(context: Context, n: DriveNode, then: (File) -> Unit) {
        val app = context.applicationContext
        cached(app, n)?.let { return then(it) }
        val t = Transfer("dl:${n.id}", n.name, "", up = false)
        if (items.any { it.key == t.key && !it.done && it.error == null }) return
        items.removeAll { it.key == t.key }
        items.add(t)
        scope.launch {
            notify(app, TITLE_DL, t, 0f)
            val r = runCatching {
                fetch(app, n) { p ->
                    update(t.key) { it.copy(progress = p) }
                    notify(app, TITLE_DL, t, p)
                }
            }
            finishIfIdle(app, t.key)
            r.onSuccess { f ->
                update(t.key) { it.copy(progress = 1f, done = true) }
                withContext(Dispatchers.Main) { then(f) }
            }.onFailure { e -> update(t.key) { it.copy(error = e.message ?: "下载失败") } }
        }
    }

    private suspend fun fetch(app: Context, n: DriveNode, progress: (Float) -> Unit): File {
        val out = target(app, n)
        out.parentFile?.mkdirs()
        val tmp = File(out.path + ".part")
        if (tmp.length() > n.size) tmp.delete()
        var stalls = 0
        var last = 0f
        var relinked = false
        while (tmp.length() < n.size) {
            val before = tmp.length()
            val req = Request.Builder().url(link(app, n)).apply { if (before > 0) header("Range", "bytes=$before-") }.build()
            val gone = withContext(Dispatchers.IO) {
                Net.client(app).newCall(req).execute().use { res ->
                    // 直链过期或文件换了位置: 换一次地址再下
                    if (res.code in RELINK && !relinked) return@use true
                    if (!res.isSuccessful) throw DriveError("下载失败 (HTTP ${res.code})", res.code)
                    val append = res.code == HTTP_PARTIAL && before > 0
                    var done = if (append) before else 0L
                    res.body!!.byteStream().use { input ->
                        java.io.FileOutputStream(tmp, append).use { o ->
                            val buf = ByteArray(BUF)
                            while (true) {
                                val k = input.read(buf)
                                if (k < 0) break
                                o.write(buf, 0, k)
                                done += k
                                val p = done.toFloat() / n.size.coerceAtLeast(1)
                                if (p - last >= STEP) {
                                    last = p
                                    progress(p)
                                }
                            }
                        }
                    }
                    false
                }
            }
            if (gone) {
                links.remove(n.id)
                relinked = true
                continue
            }
            if (tmp.length() == before && ++stalls >= CHUNK_TRIES) error("下载没有进展, 稍后再试")
        }
        if (!tmp.renameTo(out)) error("保存失败")
        return out
    }

    fun cacheBytes(context: Context): Long = File(context.filesDir, DL_DIR).walkBottomUp().filter { it.isFile }.sumOf { it.length() }

    fun clearCache(context: Context) {
        File(context.filesDir, DL_DIR).deleteRecursively()
    }

    private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    private val UNSAFE = Regex("[\\\\/:*?\"<>|]")
    private val RELINK = setOf(403, 404, 410)
    private const val HTTP_PARTIAL = 206
    private const val HTTP_CONFLICT = 409
    private const val HTTP_BAD = 400
    private const val HTTP_CLIENT_MAX = 499
    private const val HTTP_TOO_MANY = 429
    private const val HTTP_SERVER = 500
    private const val READONLY = "drive_readonly"
    private const val HTTP_BAD_GATEWAY = 502
    // 直传时这些状态可能是公网地址用不了 (被 WAF 拦, 不存在, 方法不对, 旧版要令牌), 改走转发; 真是票据的问题转发也会再报
    private val DIRECT_FALLBACK = setOf(401, 403, 404, 405, 407, 413, 451)
}

/** 同名时的编号名: a.txt → a (1).txt。 */
fun numbered(name: String, k: Int): String {
    val dot = name.lastIndexOf('.')
    return if (dot > 0) "${name.substring(0, dot)} ($k)${name.substring(dot)}" else "$name ($k)"
}
