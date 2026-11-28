package com.hengxin.aioa.net

import android.content.Context
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.InputStream

/**
 * 从文件的 offset 处开始读 (#157): 能拿到可定位的文件描述符就直接跳过去, 10 GB 文件的后几片不用从头 skip;
 * 拿不到 (管道, 云端文件) 时退回 skip。只读一段, 不把整个文件读进内存。
 */
object RangeInput {
    fun open(context: Context, uri: Uri, offset: Long): InputStream {
        if (offset > 0) seek(context, uri, offset)?.let { return it }
        val input = context.contentResolver.openInputStream(uri) ?: error(UNREADABLE)
        var skipped = 0L
        while (skipped < offset) {
            val n = input.skip(offset - skipped)
            if (n <= 0) {
                input.close()
                error(UNREADABLE)
            }
            skipped += n
        }
        return input
    }

    private fun seek(context: Context, uri: Uri, offset: Long): InputStream? {
        val pfd = runCatching { context.contentResolver.openFileDescriptor(uri, "r") }.getOrNull() ?: return null
        val input = ParcelFileDescriptor.AutoCloseInputStream(pfd)
        val ok = runCatching { input.channel.position(offset).position() == offset }.getOrDefault(false)
        if (ok) return input
        input.close()
        return null
    }

    private const val UNREADABLE = "读不了这个文件"
}
