package com.hengxin.aioa.ui.chat

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.ui.agents.ago
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val ONLINE_LABEL = "在线"
private const val DAY_FMT = "yyyy-MM-dd"

/** 成员在线 (#130): online 为现在在线的账号 id, seen 为最近在线时间 (ms)。服务端只在内存里算, 页面打开时取一次。 */
data class MemberPresence(val online: Set<String> = emptySet(), val seen: Map<String, Long> = emptyMap()) {
    fun isOnline(uid: String): Boolean = uid in online

    /** "在线" / "x 分钟前在线"; 不知道时为 null。 */
    fun label(uid: String, now: Long): String? = if (uid in online) ONLINE_LABEL else seen[uid]?.takeIf { it > 0 }?.let { "${ago(it, now)}$ONLINE_LABEL" }
}

fun parsePresence(b: JSONObject): MemberPresence {
    val arr = b.optJSONArray("online")
    val online = (0 until (arr?.length() ?: 0)).mapNotNull { i -> arr?.optString(i)?.ifEmpty { null } }.toSet()
    val seen = b.optJSONObject("seen")?.let { o -> o.keys().asSequence().associateWith { o.optLong(it) }.filterValues { it > 0 } }.orEmpty()
    return MemberPresence(online, seen)
}

/** 入群日期; 群主没有入群时间, 给 null。 */
fun joinedDay(joined: Long): String? = if (joined <= 0) null else SimpleDateFormat(DAY_FMT, Locale.CHINA).format(Date(joined))

/** 打开页面时问一次服务端谁在线, 不轮询; 非多人群或失败时为空。 */
@Composable
fun rememberPresence(group: String, shared: Boolean): MemberPresence {
    val context: Context = LocalContext.current.applicationContext
    val p by produceState(MemberPresence(), group, shared) {
        if (shared) value = RoomApi(context).presence(group).getOrNull() ?: MemberPresence()
    }
    return p
}
