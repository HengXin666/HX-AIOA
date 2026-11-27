package com.hengxin.aioa.ui.chat

import androidx.compose.runtime.mutableStateMapOf
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.agents.ago
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val ONLINE_LABEL = "在线"
private const val DAY_FMT = "yyyy-MM-dd"

/** 成员在线: online 为现在在线的账号 id, seen 为最近在线时间 (ms)。 */
data class MemberPresence(val online: Set<String> = emptySet(), val seen: Map<String, Long> = emptyMap()) {
    fun isOnline(uid: String): Boolean = uid in online

    /** "在线" / "x 分钟前在线"; 不知道时为 null。 */
    fun label(uid: String, now: Long): String? = if (uid in online) ONLINE_LABEL else seen[uid]?.takeIf { it > 0 }?.let { "${ago(it, now)}$ONLINE_LABEL" }
}

/**
 * 同群真人谁在线 (#139, 规范 §3): 只靠长连接的 online 帧, 不发请求。
 * 连上时服务端给一帧全量, 之后有人上下线推增量; 断线期间的变化等重连的全量补上。
 */
object PeopleOnline {
    private val online = mutableStateMapOf<String, Boolean>()
    private val seen = mutableStateMapOf<String, Long>()

    fun apply(f: ServerFrame.Online) {
        if (f.full) {
            online.clear()
            seen.clear()
        }
        f.online.forEach { online[it] = true }
        f.seen.forEach { (id, at) ->
            online.remove(id)
            seen[id] = at
        }
    }

    /** 当前快照; 在组合里读会随帧重组。 */
    fun snapshot(): MemberPresence = MemberPresence(online.keys.toSet(), seen.toMap())
}

/** 入群日期; 群主没有入群时间, 给 null。 */
fun joinedDay(joined: Long): String? = if (joined <= 0) null else SimpleDateFormat(DAY_FMT, Locale.CHINA).format(Date(joined))
