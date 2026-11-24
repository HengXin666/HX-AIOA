package com.hengxin.aioa.ui.chat

import androidx.compose.runtime.mutableStateMapOf
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.proto.PresenceEntry
import com.hengxin.aioa.proto.ServerFrame

private const val USER_PREFIX = "user:"
private const val MAX_NAMES = 2

/** 群里谁在监听 / 输入: 服务端只在变化时推一帧, 到点过期由这里按 until 自己判断。 */
class ChatPresence {
    private val frames = mutableStateMapOf<String, ServerFrame.Presence>()

    fun apply(f: ServerFrame.Presence) {
        if (f.listening.isEmpty() && f.typing.isEmpty()) frames.remove(f.channel) else frames[f.channel] = f
    }

    /** 顶栏显示的一行; 输入优先于监听, 自己不算; 都没有时为 null。 */
    fun line(channel: String, now: Long): String? {
        val f = frames[channel] ?: return null
        val self = Me.uid?.let { USER_PREFIX + it }
        fun live(list: List<PresenceEntry>) = list.filter { (it.until == 0L || it.until > now) && it.id != self }.map { it.name }.distinct()
        val typing = live(f.typing)
        if (typing.isNotEmpty()) return "${names(typing)} 正在输入…"
        val listening = live(f.listening)
        return if (listening.isEmpty()) null else "${names(listening)} 正在监听"
    }

    private fun names(list: List<String>): String =
        if (list.size <= MAX_NAMES) list.joinToString(", ") else "${list.take(MAX_NAMES).joinToString(", ")} 等 ${list.size} 个"
}
