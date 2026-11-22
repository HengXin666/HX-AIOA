package com.hengxin.aioa.data

import android.content.Context
import java.io.File

// 免打扰的群: 界面进程写, :link 进程读来决定是否响铃; 按文件修改时间缓存
object MutedGroups {
    private const val FILE = "muted-groups.txt"

    @Volatile
    private var cache: Pair<Long, Set<String>> = 0L to emptySet()

    fun write(context: Context, groups: Set<String>) {
        val f = File(context.filesDir, FILE)
        val tmp = File(f.path + ".tmp")
        tmp.writeText(groups.joinToString("\n"))
        tmp.renameTo(f)
    }

    fun contains(context: Context, group: String): Boolean {
        val f = File(context.filesDir, FILE)
        val stamp = f.lastModified()
        if (stamp != cache.first) cache = stamp to runCatching { f.readLines().filter { it.isNotEmpty() }.toSet() }.getOrDefault(emptySet())
        return group in cache.second
    }
}
