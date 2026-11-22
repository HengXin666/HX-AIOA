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

// 群名: 界面进程写, :link 进程发通知时用来显示群名而不是 channel; 每行 "群键\t名称"
object GroupTitles {
    private const val FILE = "group-titles.txt"
    private const val SEP = '\t'

    @Volatile
    private var cache: Pair<Long, Map<String, String>> = 0L to emptyMap()

    fun write(context: Context, titles: Map<String, String>) {
        val f = File(context.filesDir, FILE)
        val tmp = File(f.path + ".tmp")
        tmp.writeText(titles.entries.joinToString("\n") { "${it.key}$SEP${it.value.replace('\n', ' ')}" })
        tmp.renameTo(f)
    }

    fun of(context: Context, group: String): String {
        val f = File(context.filesDir, FILE)
        val stamp = f.lastModified()
        if (stamp != cache.first) cache = stamp to runCatching {
            f.readLines().mapNotNull { l -> l.split(SEP, limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } }.toMap()
        }.getOrDefault(emptyMap())
        return cache.second[group] ?: group
    }
}
