package com.hengxin.aioa.ui.chat

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import com.hengxin.aioa.config.ConfigStore
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
import org.json.JSONObject
import java.io.File

/** 文件上传下载: 先向服务端登记 / 换地址, 字节直接走 R2; 下载过的文件留在本机, 同一个文件只下载一次。 */
object FileTransfer {
    private const val FILES_API = "api/v1/files"
    private const val LINK = "link"
    private const val DIR = "att"
    private const val CHUNK = 64 * 1024
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
            val put = Request.Builder().url(absolute(context, made.getString("upload"))).put(stream(context, uri, size, mime, progress)).build()
            Net.client(context).newCall(put).execute().use { if (!it.isSuccessful) error(errorOf(it.body?.string(), it.code)) }
            runCatching { copy(context, uri, target(context, ref)) }
            ref
        }
    }

    /** 换下载地址并下到本机; 已经有了直接返回。 */
    suspend fun download(context: Context, f: FileRef, progress: (Float) -> Unit): Result<File> = withContext(Dispatchers.IO) {
        runCatching {
            cached(context, f)?.let { return@runCatching it }
            val r = Api.call(context, "GET", listOf(FILES_API, f.id, LINK))
            val url = r.body?.optString("url")?.ifEmpty { null } ?: error(r.error ?: "文件不存在或已删除")
            val out = target(context, f)
            out.parentFile?.mkdirs()
            val tmp = File(out.path + ".part")
            Net.client(context).newCall(Request.Builder().url(absolute(context, url)).build()).execute().use { res ->
                if (!res.isSuccessful) error(errorOf(res.body?.string(), res.code))
                val total = res.body?.contentLength()?.takeIf { it > 0 } ?: f.size
                res.body!!.byteStream().use { input ->
                    tmp.outputStream().use { o ->
                        val buf = ByteArray(CHUNK)
                        var done = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            o.write(buf, 0, n)
                            done += n
                            progress(done.toFloat() / total)
                        }
                    }
                }
            }
            if (!tmp.renameTo(out)) error("保存失败")
            out
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

    private fun stream(context: Context, uri: Uri, size: Long, mime: String, progress: (Float) -> Unit) = object : RequestBody() {
        override fun contentType(): MediaType? = mime.toMediaTypeOrNull()

        override fun contentLength(): Long = size

        override fun writeTo(sink: BufferedSink) {
            val input = context.contentResolver.openInputStream(uri) ?: error("读不了这个文件")
            input.use {
                val buf = ByteArray(CHUNK)
                var done = 0L
                while (true) {
                    val n = it.read(buf)
                    if (n < 0) break
                    sink.write(buf, 0, n)
                    done += n
                    progress(done.toFloat() / size)
                }
            }
        }
    }
}
