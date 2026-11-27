package com.hengxin.aioa.ui.chat

import android.content.Context
import java.io.File

/**
 * 拍照的临时文件 (#139): 相机写进 files/att/photo_*.jpg, 发出去时上传会另拷一份进按文件 id 的缓存,
 * 这张原图就没用了。启动时删掉 7 天前的, 只动 photo_ 开头的顶层文件, 不碰已下载的附件目录。
 */
object Photos {
    const val DIR = "att"
    const val PREFIX = "photo_"
    private const val KEEP_MS = 7 * 24 * 3600_000L

    /** 返回删掉了几个; 在后台线程调用。 */
    fun clean(context: Context, now: Long = System.currentTimeMillis()): Int {
        val old = File(context.filesDir, DIR).listFiles().orEmpty().filter { stale(it.name, it.isFile, it.lastModified(), now) }
        return old.count { it.delete() }
    }

    /** 该不该删: 顶层的 photo_ 文件且超过 7 天没改过。 */
    fun stale(name: String, isFile: Boolean, modified: Long, now: Long): Boolean = isFile && name.startsWith(PREFIX) && now - modified > KEEP_MS
}
