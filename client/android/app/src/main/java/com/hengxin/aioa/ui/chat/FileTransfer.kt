package com.hengxin.aioa.ui.chat

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.config.TgBots
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.Net
import com.hengxin.aioa.proto.FileRef
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** 文件上传下载: 先向服务端登记 / 换地址, 字节直接走存储后端 (R2 或 HX-CF-Drive, 由服务端决定); 下载过的文件留在本机, 同一个文件只下载一次。 */
object FileTransfer {
    private const val FILES_API = "api/v1/files"
    private const val LINK = "link"
    private const val COMMIT = "commit"
    private const val QUERY_DIRECT = "direct"
    private const val KEY_DIRECT = "direct"
    private const val CHUNK_TRIES = 3
    private const val RETRY_SEC = 2L
    private const val RETRY_MAX_SEC = 60L
    private const val DIR = "att"
    private const val CHUNK = 64 * 1024
    private const val HTTP_PARTIAL = 206
    private const val HTTP_RANGE_BAD = 416
    private const val MAX_STALLS = 3
    private val RELINK_CODES = setOf(403, 404, 410)
    private const val DEFAULT_MIME = "application/octet-stream"
    private val UNSAFE = Regex("[\\\\/:*?\"<>|]")

    /** 本机已下载的副本, 没有返回 null。 */
    fun cached(context: Context, f: FileRef): File? = target(context, f).takeIf { it.isFile && it.length() == f.size }

    private fun target(context: Context, f: FileRef): File = File(File(context.filesDir, "$DIR/${f.id}"), f.name.replace(UNSAFE, "_"))

    /** 选中的文件: 名字, 大小, 类型。 */
    fun describe(context: Context, uri: Uri): Triple<String, Long, String> {
        var name = uri.lastPathSegment ?: "文件"
        var size = -1L
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) ?: name }
                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { if (!c.isNull(it)) size = c.getLong(it) }
            }
        }
        return Triple(name, size, context.contentResolver.getType(uri) ?: DEFAULT_MIME)
    }

    /** 登记并上传, 进度 0..1; 成功返回引用 (同时把原文件拷进本机缓存, 自己发的不用再下载)。 */
    suspend fun upload(context: Context, uri: Uri, channel: String?, progress: (Float) -> Unit): Result<FileRef> = withContext(Dispatchers.IO) {
        runCatching {
            val (name, size, mime) = describe(context, uri)
            if (size <= 0) error("读不到文件大小")
            val body = JSONObject().put("name", name).put("size", size).put("mime", mime)
            channel?.let { body.put("channel", it) }
            val r = Api.call(context, "POST", listOf(FILES_API), body)
            val made = r.body ?: error(r.error ?: "登记失败")
            val ref = FileRef.parse(made.optJSONObject("file")) ?: error("登记失败")
            val upload = absolute(context, made.getString("upload"))
            val chunks = made.optJSONObject("chunks")
            if (chunks == null) {
                val put = Request.Builder().url(upload).put(stream(context, uri, 0, size, mime) { progress(it.toFloat() / size) }).build()
                Net.client(context).newCall(put).execute().use { if (!it.isSuccessful) error(errorOf(it.body?.string(), it.code)) }
                runCatching { copy(context, uri, target(context, ref)) }
            } else {
                uploadChunks(context, uri, ref, upload, chunks.getLong("size"), chunks.getInt("count"), mime, progress)
                // 超过 95 MB 的不拷进本机缓存 (太占空间), 要看时再下载
            }
            ref
        }
    }

    /**
     * 换下载地址并下到本机; 已经有了直接返回。
     * - 断点续传: 上次没下完的 .part 留着, 这次带 Range 从断点接着下; 服务器回 200 (不支持 Range) 就从头写。
     * - 一次响应没给全 (Drive 单次最多回一段, 206 截断) 时接着用 Range 拉剩下的。
     * - 地址失效 (过期, 文件被迁到别的后端): 403 / 404 / 410 时重新换一次地址再下, 只重试一次。
     */
    suspend fun download(context: Context, f: FileRef, progress: (Float) -> Unit): Result<File> = withContext(Dispatchers.IO) {
        runCatching {
            cached(context, f)?.let { return@runCatching it }
            val out = target(context, f)
            out.parentFile?.mkdirs()
            // TG 直连: 存了 Bot 令牌就带 direct=1 换地址, 服务端给了分片清单 (主人且开了直连) 就从 TG 并发拉
            if (TgBots.any(context)) {
                val r = Api.call(context, "GET", listOf(FILES_API, f.id, LINK), query = mapOf(QUERY_DIRECT to "1"))
                val body = r.body ?: error(r.error ?: "文件不存在或已删除")
                body.optJSONObject(KEY_DIRECT)?.let { d ->
                    TgDirect.download(context, f, d, absolute(context, body.getString("url")), out, progress)
                    return@runCatching out
                }
            }
            val tmp = File(out.path + ".part")
            if (tmp.length() > f.size) tmp.delete()
            var relinked = false
            var url = link(context, f)
            var stalls = 0
            while (tmp.length() < f.size) {
                val before = tmp.length()
                try {
                    fetchRange(context, url, tmp, f.size, progress)
                } catch (e: LinkGone) {
                    if (relinked) throw e
                    relinked = true
                    url = link(context, f)
                    continue
                }
                if (tmp.length() == before && ++stalls >= MAX_STALLS) error("下载没有进展, 稍后再试")
            }
            if (tmp.length() != f.size) error("下载的大小不对")
            if (!tmp.renameTo(out)) error("保存失败")
            out
        }
    }

    /** 本机附件缓存占用的字节数。 */
    fun cacheBytes(context: Context): Long = File(context.filesDir, DIR).walkBottomUp().filter { it.isFile }.sumOf { it.length() }

    /** 删掉本机所有下载过的附件 (含没下完的), 服务端不受影响。 */
    fun clearCache(context: Context) {
        File(context.filesDir, DIR).deleteRecursively()
    }

    private class LinkGone(message: String) : Exception(message)

    private fun link(context: Context, f: FileRef): String {
        val r = Api.call(context, "GET", listOf(FILES_API, f.id, LINK))
        return absolute(context, r.body?.optString("url")?.ifEmpty { null } ?: error(r.error ?: "文件不存在或已删除"))
    }

    /** 从 tmp 现有长度接着下一段, 追加写入; 地址失效抛 LinkGone。 */
    private fun fetchRange(context: Context, url: String, tmp: File, size: Long, progress: (Float) -> Unit) {
        val have = tmp.length()
        val req = Request.Builder().url(url).apply { if (have > 0) header("Range", "bytes=$have-") }.build()
        Net.client(context).newCall(req).execute().use { res ->
            if (res.code in RELINK_CODES) throw LinkGone(errorOf(res.body?.string(), res.code))
            if (res.code == HTTP_RANGE_BAD) {
                tmp.delete()
                return
            }
            if (!res.isSuccessful) error(errorOf(res.body?.string(), res.code))
            val append = res.code == HTTP_PARTIAL && have > 0
            var done = if (append) have else 0L
            res.body!!.byteStream().use { input ->
                java.io.FileOutputStream(tmp, append).use { o ->
                    val buf = ByteArray(CHUNK)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        o.write(buf, 0, n)
                        done += n
                        progress(done.toFloat() / size)
                    }
                }
            }
        }
    }

    /** 用系统里能打开这种文件的应用打开。 */
    fun open(context: Context, file: File, mime: String): Boolean {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { context.startActivity(Intent.createChooser(view, "打开").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
    }

    fun sizeText(bytes: Long): String = when {
        bytes >= 1L shl 30 -> "%.1f GB".format(bytes / (1L shl 30).toDouble())
        bytes >= 1L shl 20 -> "%.1f MB".format(bytes / (1L shl 20).toDouble())
        bytes >= 1L shl 10 -> "%.0f KB".format(bytes / (1L shl 10).toDouble())
        else -> "$bytes B"
    }

    private fun absolute(context: Context, path: String): String =
        if (path.startsWith("http")) path else (ConfigStore.load(context)?.server ?: error("还没有配置服务端")).trimEnd('/') + path

    private fun errorOf(body: String?, code: Int): String =
        runCatching { JSONObject(body.orEmpty()).optString("error") }.getOrNull()?.ifEmpty { null } ?: "传输失败 (HTTP $code)"

    private fun copy(context: Context, uri: Uri, to: File) {
        to.parentFile?.mkdirs()
        context.contentResolver.openInputStream(uri)?.use { i -> to.outputStream().use { i.copyTo(it) } }
    }

    /**
     * 分片上传 (超过 95 MB, 服务端转给 Drive): 逐片 PUT 到 `upload&i=<序号>`, 收齐回执后提交。
     * 每片最多试 3 次; 429 / 503 按 Retry-After 等 (最多 60 秒), 其他 4xx 直接失败。
     */
    private fun uploadChunks(context: Context, uri: Uri, ref: FileRef, upload: String, chunkSize: Long, count: Int, mime: String, progress: (Float) -> Unit) {
        val receipts = JSONArray()
        for (i in 0 until count) {
            val off = i * chunkSize
            val len = minOf(chunkSize, ref.size - off)
            receipts.put(putChunk(context, uri, "$upload&i=$i", off, len, mime) { progress((off + it).toFloat() / ref.size) })
        }
        val r = Api.call(context, "POST", listOf(FILES_API, ref.id, COMMIT), JSONObject().put("receipts", receipts))
        if (r.body == null) error(r.error ?: "提交失败")
    }

    private fun putChunk(context: Context, uri: Uri, url: String, off: Long, len: Long, mime: String, progress: (Long) -> Unit): String {
        var last = ""
        repeat(CHUNK_TRIES) { attempt ->
            val req = Request.Builder().url(url).put(stream(context, uri, off, len, mime, progress)).build()
            val wait = runCatching {
                Net.client(context).newCall(req).execute().use { res ->
                    val text = res.body?.string()
                    if (res.isSuccessful) return JSONObject(text.orEmpty()).getString("receipt")
                    last = errorOf(text, res.code)
                    when {
                        res.code == 429 || res.code == 503 -> (res.header("Retry-After")?.toLongOrNull() ?: RETRY_SEC).coerceAtMost(RETRY_MAX_SEC)
                        res.code in 400..499 -> error(last)
                        else -> RETRY_SEC
                    }
                }
            }.getOrElse { e ->
                if (e is IllegalStateException) throw e
                last = "网络错误: ${e.message ?: e.javaClass.simpleName}"
                RETRY_SEC
            }
            if (attempt < CHUNK_TRIES - 1) Thread.sleep(wait * 1000)
        }
        error(last)
    }

    /** 文件的 [offset, offset + length) 一段作为请求体; progress 报这一段已写出的字节数。 */
    private fun stream(context: Context, uri: Uri, offset: Long, length: Long, mime: String, progress: (Long) -> Unit) = object : RequestBody() {
        override fun contentType(): MediaType? = mime.toMediaTypeOrNull()

        override fun contentLength(): Long = length

        override fun writeTo(sink: BufferedSink) {
            com.hengxin.aioa.net.RangeInput.open(context, uri, offset).use {
                val buf = ByteArray(CHUNK)
                var done = 0L
                while (done < length) {
                    val n = it.read(buf, 0, minOf(buf.size.toLong(), length - done).toInt())
                    if (n < 0) error("文件比登记的小")
                    sink.write(buf, 0, n)
                    done += n
                    progress(done)
                }
            }
        }
    }
}
