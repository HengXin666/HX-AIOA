package com.hengxin.aioa.ui.drive

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import java.io.File
import java.io.FileOutputStream
import java.io.FilterOutputStream
import java.io.OutputStream
import java.io.RandomAccessFile

private const val PART = ".part"
private const val SUB_DIR = "AIOA"
private const val OCTET = "application/octet-stream"

/**
 * 下载的半截存放处 (#158): length 是已有字节, open(offset) 截到 offset 后从那里接着写, finish 去掉 .part 并按冲突编号,
 * 返回给系统打开用的 Uri; drop 删掉半截。key 用来在重开 App 后找回它。
 */
internal interface PartSink {
    val key: String
    fun length(): Long
    fun open(offset: Long): OutputStream
    fun finish(name: String, mime: String): Uri
    fun drop()
}

/** 私有目录里的文件 (预览缓存, 旧系统的保存): .part 写完改名。 */
internal class FileSink(private val part: File, private val uriOf: (File) -> Uri) : PartSink {
    override val key: String get() = part.path
    // 完成后的文件 (保存记录与 "打开" 要用)
    var saved: File? = null
        private set

    override fun length(): Long = if (part.isFile) part.length() else 0

    override fun open(offset: Long): OutputStream {
        part.parentFile?.mkdirs()
        RandomAccessFile(part, "rw").use { it.setLength(offset) }
        return FileOutputStream(part, true)
    }

    override fun finish(name: String, mime: String): Uri {
        val dir = part.parentFile ?: error("保存失败")
        val out = File(dir, uniqueName(name) { File(dir, it).exists() })
        if (!part.renameTo(out)) error("保存失败")
        saved = out
        return uriOf(out)
    }

    override fun drop() {
        part.delete()
    }

    companion object {
        fun partOf(dir: File, id: String) = File(dir, "$id$PART")
    }
}

/** 系统下载目录 (Download/AIOA) 里的 pending 条目, 名字带 .part, 完成后改名并公开; 不要存储权限。 */
@RequiresApi(Build.VERSION_CODES.Q)
internal class MediaSink(private val context: Context, private val uri: Uri) : PartSink {
    override val key: String get() = uri.toString()

    override fun length(): Long = runCatching { context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: 0 }.getOrDefault(0)

    override fun open(offset: Long): OutputStream {
        val fd = context.contentResolver.openFileDescriptor(uri, "rw") ?: error("打不开下载目录里的文件")
        val out = FileOutputStream(fd.fileDescriptor)
        out.channel.truncate(offset)
        out.channel.position(offset)
        return object : FilterOutputStream(out) {
            override fun write(b: ByteArray, off: Int, len: Int) = out.write(b, off, len)
            override fun close() {
                runCatching { out.close() }
                fd.close()
            }
        }
    }

    override fun finish(name: String, mime: String): Uri {
        val taken = namesInDir(context)
        val v = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, uniqueName(name) { it in taken })
            put(MediaStore.MediaColumns.MIME_TYPE, mime.ifEmpty { OCTET })
            put(MediaStore.MediaColumns.IS_PENDING, 0)
        }
        context.contentResolver.update(uri, v, null, null)
        return uri
    }

    override fun drop() {
        runCatching { context.contentResolver.delete(uri, null, null) }
    }

    companion object {
        private val RELATIVE = "${Environment.DIRECTORY_DOWNLOADS}/$SUB_DIR/"

        fun create(context: Context, name: String): MediaSink {
            val v = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name + PART)
                // 用 octet-stream 免得系统按类型改扩展名
                put(MediaStore.MediaColumns.MIME_TYPE, OCTET)
                put(MediaStore.MediaColumns.RELATIVE_PATH, RELATIVE)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: error("系统下载目录不可写")
            return MediaSink(context, uri)
        }

        private fun namesInDir(context: Context): Set<String> {
            val out = HashSet<String>()
            val proj = arrayOf(MediaStore.MediaColumns.DISPLAY_NAME)
            context.contentResolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, proj, "${MediaStore.MediaColumns.RELATIVE_PATH}=?", arrayOf(RELATIVE), null)?.use { c ->
                while (c.moveToNext()) out.add(c.getString(0))
            }
            return out
        }

        /** 条目还在且大小对得上。 */
        fun alive(context: Context, uri: Uri, size: Long): Boolean =
            runCatching { context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize == size } ?: false }.getOrDefault(false)
    }
}

/** 保存到手机的目标: Android 10 起系统下载目录, 之前的版本存到 App 的外部下载目录 (同样不要权限)。 */
internal object SaveTarget {
    fun legacyDir(context: Context): File = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: File(context.filesDir, "dl"), SUB_DIR)

    fun create(context: Context, id: String, name: String): PartSink =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaSink.create(context, name) else FileSink(FileSink.partOf(legacyDir(context), id)) { shareUri(context, it) }

    /** 按保存时记下的 key 找回半截。 */
    fun reopen(context: Context, key: String): PartSink =
        if (key.startsWith("content:") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaSink(context, Uri.parse(key)) else FileSink(File(key)) { shareUri(context, it) }

    /** 保存过的文件还在不在。 */
    fun alive(context: Context, uri: Uri, size: Long, path: String?): Boolean = when {
        uri.scheme == "content" && path == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> MediaSink.alive(context, uri, size)
        path != null -> File(path).let { it.isFile && it.length() == size }
        else -> false
    }
}
