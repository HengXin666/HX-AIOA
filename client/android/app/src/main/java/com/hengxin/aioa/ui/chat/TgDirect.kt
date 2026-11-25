package com.hengxin.aioa.ui.chat

import android.content.Context
import com.hengxin.aioa.config.TgBots
import com.hengxin.aioa.net.Net
import com.hengxin.aioa.proto.FileRef
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicLong

/**
 * TG 直连拉取 (主人设备): 按服务端给的分片清单, 用本机保存的 Bot 令牌 getFile 后从 TG 下载每片, 字节不经过 Worker。
 * - 默认 3 片并发, 每片写到 i * chunkSize 的偏移, 校验大小; 完成的片记在 .tgdone, 中断后只补缺的片。
 * - 只在两种情况下这一片改从 Drive 取 (url 加 Range): 手机上没有这一片的 Bot 令牌, 或 TG 说 file_id 无效
 *   (Drive 换过 Bot 重新绑定)。令牌无效, 限流, 网络错误等直接报错, 不悄悄换路。
 * - 走 App 的代理 (Net.client), 国内直连不通 TG。
 */
object TgDirect {
    private const val TG = "https://api.telegram.org"
    private const val PARALLEL = 3
    private const val BUF = 64 * 1024
    private const val HTTP_PARTIAL = 206
    private val JSON = "application/json".toMediaType()

    private class FileIdGone : Exception()

    suspend fun download(context: Context, f: FileRef, d: JSONObject, url: String, out: File, progress: (Float) -> Unit) {
        val chunkSize = d.getLong("chunkSize")
        val list = d.getJSONArray("chunks")
        val n = list.length()
        if (d.getLong("size") != f.size) error("分片清单的大小和文件不一致")
        val tmp = File(out.path + ".tg")
        val doneFile = File(out.path + ".tgdone")
        val done = if (tmp.isFile && doneFile.isFile) doneFile.readLines().mapNotNull { it.toIntOrNull() }.toMutableSet() else mutableSetOf()
        if (done.isEmpty()) doneFile.delete()
        val bots = TgBots.load(context)
        val got = AtomicLong(done.sumOf { list.getJSONObject(it).getLong("size") })
        RandomAccessFile(tmp, "rw").use { raf ->
            raf.setLength(f.size)
            val ch = raf.channel
            val lock = Any()
            val sem = Semaphore(PARALLEL)
            coroutineScope {
                (0 until n).filter { it !in done }.map { i ->
                    async {
                        sem.withPermit {
                            val c = list.getJSONObject(i)
                            val size = c.getLong("size")
                            val off = i * chunkSize
                            val token = bots[c.getString("bot")]
                            val write = { pos: Long, buf: ByteArray, len: Int ->
                                ch.write(ByteBuffer.wrap(buf, 0, len), pos)
                                progress(got.addAndGet(len.toLong()).toFloat() / f.size)
                            }
                            var wrote = if (token == null) -1L else runCatching { fromTg(context, token, c.getString("fileId"), off, write) }.getOrElse { if (it is FileIdGone) -1L else throw it }
                            if (wrote < 0) wrote = fromDrive(context, url, off, size, write)
                            if (wrote != size) error("第 ${i + 1} 片大小不对 ($wrote / $size)")
                            synchronized(lock) { doneFile.appendText("$i\n") }
                        }
                    }
                }.awaitAll()
            }
        }
        if (tmp.length() != f.size) error("下载的大小不对")
        if (!tmp.renameTo(out)) error("保存失败")
        doneFile.delete()
    }

    /** 从 TG 下一片; file_id 无效抛 FileIdGone。返回写入的字节数。 */
    private fun fromTg(context: Context, token: String, fileId: String, off: Long, write: (Long, ByteArray, Int) -> Unit): Long {
        val client = Net.client(context)
        val req = Request.Builder().url("$TG/bot$token/getFile").post(JSONObject().put("file_id", fileId).toString().toRequestBody(JSON)).build()
        val path = client.newCall(req).execute().use { res ->
            val j = runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull()
            val desc = j?.optString("description").orEmpty()
            if (res.code == 400 && desc.contains("file_id", ignoreCase = true)) throw FileIdGone()
            if (!res.isSuccessful || j?.optBoolean("ok") != true) error("TG getFile 失败 (Bot ${TgBots.botId(token)}, HTTP ${res.code}): $desc")
            j.getJSONObject("result").getString("file_path")
        }
        return client.newCall(Request.Builder().url("$TG/file/bot$token/$path").build()).execute().use { res ->
            if (!res.isSuccessful) error("TG 下载失败 (Bot ${TgBots.botId(token)}, HTTP ${res.code})")
            copy(res.body!!.byteStream(), off, write)
        }
    }

    /** 这一片从 Drive 取: Range 请求, 要求 206 (只有一片且从 0 开始时 200 也行)。 */
    private fun fromDrive(context: Context, url: String, off: Long, size: Long, write: (Long, ByteArray, Int) -> Unit): Long {
        val req = Request.Builder().url(url).header("Range", "bytes=$off-${off + size - 1}").build()
        return Net.client(context).newCall(req).execute().use { res ->
            if (res.code != HTTP_PARTIAL && !(res.code == 200 && off == 0L)) error("从 Drive 取分片失败 (HTTP ${res.code})")
            copy(res.body!!.byteStream(), off, write, limit = size)
        }
    }

    private fun copy(input: java.io.InputStream, off: Long, write: (Long, ByteArray, Int) -> Unit, limit: Long = Long.MAX_VALUE): Long =
        input.use {
            val buf = ByteArray(BUF)
            var pos = 0L
            while (pos < limit) {
                val n = it.read(buf, 0, minOf(BUF.toLong(), limit - pos).toInt())
                if (n < 0) break
                write(off + pos, buf, n)
                pos += n
            }
            pos
        }
}
