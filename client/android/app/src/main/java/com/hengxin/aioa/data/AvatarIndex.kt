package com.hengxin.aioa.data

import android.content.Context
import java.io.File

/**
 * 通知用的头像索引 (#151): 界面进程写 "群 / 发送者 -> 头像 id", :link 进程读了再去磁盘头像缓存取图,
 * 不加载 UI 类, 也不为通知联网。每行 "类别\t键\t头像 id"; 按文件修改时间缓存。
 */
object AvatarIndex {
    private const val FILE = "avatar-index.txt"
    private const val SEP = '\t'
    private const val GROUP = "g"
    private const val SENDER = "s"
    private const val MEMBER = "u"
    // 群成员头像只在打开某个群时拉到, 只增不减, 超过上限丢最早记下的
    private const val MEMBER_MAX = 500
    private val lock = Any()

    @Volatile
    private var cache: Pair<Long, Map<String, String>> = 0L to emptyMap()

    /** 群资料里的头像 (单聊由服务端填对方头像), 整类替换。 */
    fun writeGroups(context: Context, avatars: Map<String, String>) = replace(context, GROUP, avatars)

    /** 主人给系统发送者与 Agent 设的头像, 整类替换。 */
    fun writeSenders(context: Context, avatars: Map<String, String>) = replace(context, SENDER, avatars)

    /** 群成员 (真人, 键为 user:<uid>) 的头像, 合并进去。 */
    fun addMembers(context: Context, avatars: Map<String, String>) = synchronized(lock) {
        val all = read(context)
        val kept = all.filterKeys { !it.startsWith(MEMBER + SEP) }
        val members = LinkedHashMap(all.filterKeys { it.startsWith(MEMBER + SEP) })
        avatars.forEach { (k, v) -> members.remove(key(MEMBER, k)); members[key(MEMBER, k)] = v }
        save(context, all, kept + members.entries.toList().takeLast(MEMBER_MAX).associate { it.key to it.value })
    }

    fun group(context: Context, key: String): String? = lookup(context)[key(GROUP, key)]

    /** 发送者: 主人设的图片优先, 其次成员资料里的头像。 */
    fun sender(context: Context, sid: String): String? = lookup(context).let { it[key(SENDER, sid)] ?: it[key(MEMBER, sid)] }

    private fun replace(context: Context, kind: String, avatars: Map<String, String>) = synchronized(lock) {
        val all = read(context)
        save(context, all, all.filterKeys { !it.startsWith(kind + SEP) } + avatars.entries.associate { key(kind, it.key) to it.value })
    }

    private fun key(kind: String, k: String) = kind + SEP + k.replace(SEP, ' ').replace('\n', ' ')

    private fun save(context: Context, old: Map<String, String>, next: Map<String, String>) {
        if (old == next) return
        val f = File(context.filesDir, FILE)
        val tmp = File(f.path + ".tmp")
        tmp.writeText(next.entries.joinToString("\n") { "${it.key}$SEP${it.value}" })
        tmp.renameTo(f)
    }

    private fun lookup(context: Context): Map<String, String> {
        val stamp = File(context.filesDir, FILE).lastModified()
        if (stamp != cache.first) cache = stamp to read(context)
        return cache.second
    }

    private fun read(context: Context): Map<String, String> = runCatching {
        val out = LinkedHashMap<String, String>()
        File(context.filesDir, FILE).takeIf { it.exists() }?.readLines()?.forEach { l ->
            val p = l.split(SEP, limit = 3)
            if (p.size == 3 && p[2].isNotEmpty()) out[p[0] + SEP + p[1]] = p[2]
        }
        out
    }.getOrDefault(emptyMap())
}
