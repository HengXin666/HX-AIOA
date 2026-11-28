package com.hengxin.aioa.ui.drive

import android.content.Context
import com.hengxin.aioa.net.Net
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/**
 * 预览用的临时缓存 (#158): App 的 cache/drive-preview, 不进下载目录; 每次预览前清掉一天前的, 总量超过上限时从最旧的删。
 * 系统空间紧张时也会自己清 cache 目录。
 */
internal object PreviewCache {
    private const val DIR = "drive-preview"
    private const val MAX_BYTES = 300L * 1024 * 1024
    private const val KEEP_MS = 24 * 3600_000L

    private fun root(context: Context) = File(context.cacheDir, DIR)

    /** 预览要整份文件 (图片, PDF, 用其他应用打开) 时下到缓存; 有了直接用。可续传, onBytes 为累计字节。 */
    suspend fun file(context: Context, n: DriveNode, onBytes: (Long) -> Unit = {}): File = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        val dir = File(root(app), n.id)
        val name = n.name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "file" }
        val done = File(dir, name)
        if (done.isFile && done.length() == n.size) return@withContext done.also { it.setLastModified(System.currentTimeMillis()) }
        trim(app)
        dir.mkdirs()
        val part = File(dir, "$name.part")
        fetchTo(app, n, FileSink(part) { shareUri(app, it) }, onBytes)
        done.delete()
        if (!part.renameTo(done)) error("缓存失败")
        done
    }

    /** 文本只读前 limit 字节 (Range), 不落盘; 截断时 cut 为 true。不是合法 UTF-8 的地方用替换字符。 */
    suspend fun text(context: Context, n: DriveNode, limit: Long = TEXT_PREVIEW_MAX): Pair<String, Boolean> = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        val want = minOf(limit, n.size)
        val req = Request.Builder().url(DriveTransfers.link(app, n)).apply { if (want > 0) header("Range", "bytes=0-${want - 1}") }.build()
        val bytes = Net.client(app).newCall(req).execute().use { res ->
            if (res.code in RELINK) DriveTransfers.forgetLink(n.id)
            if (!res.isSuccessful) throw DriveError("读取失败 (HTTP ${res.code})", res.code)
            res.body?.byteStream()?.use { readUpTo(it, want.toInt()) } ?: ByteArray(0)
        }
        decodeLenient(bytes) to (n.size > bytes.size)
    }

    private fun readUpTo(input: java.io.InputStream, max: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(BUF)
        while (out.size() < max) {
            val k = input.read(buf, 0, minOf(buf.size, max - out.size()))
            if (k < 0) break
            out.write(buf, 0, k)
        }
        return out.toByteArray()
    }

    fun bytes(context: Context): Long = root(context).walkBottomUp().filter { it.isFile }.sumOf { it.length() }

    fun clear(context: Context) {
        root(context).deleteRecursively()
    }

    /** 删一天前的; 还超上限就按最近使用从旧到新删。 */
    fun trim(context: Context, now: Long = System.currentTimeMillis()) {
        val dirs = root(context).listFiles().orEmpty().filter { it.isDirectory }
        dirs.filter { d -> now - (d.listFiles().orEmpty().maxOfOrNull { it.lastModified() } ?: 0) > KEEP_MS }.forEach { it.deleteRecursively() }
        var total = bytes(context)
        for (d in root(context).listFiles().orEmpty().sortedBy { d -> d.listFiles().orEmpty().maxOfOrNull { it.lastModified() } ?: 0 }) {
            if (total <= MAX_BYTES) break
            total -= d.walkBottomUp().filter { it.isFile }.sumOf { it.length() }
            d.deleteRecursively()
        }
    }

    private const val BUF = 16 * 1024
    private val RELINK = setOf(403, 410)
}

/** UTF-8 解码, 截断在多字节字符中间或有坏字节时用替换字符, 不抛错。 */
internal fun decodeLenient(bytes: ByteArray): String =
    Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE).decode(ByteBuffer.wrap(bytes)).toString()
