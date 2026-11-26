package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.proto.ServerFrame
import org.json.JSONObject

/**
 * 发送者头像 (#123): 主人给来源 (sid) 设的图片头像, 服务端存, chat_sync senders 时重拉;
 * 没设的系统来源 (system:*) 画内置图标, 其余字母头像。
 */
object Senders {
    private val avatars = mutableStateMapOf<String, String>()
    const val PATH = "api/v1/senders"
    const val CACHE = "senders"
    const val TOPIC = "senders"
    private const val SYSTEM_PREFIX = "system:"
    // 系统来源的内置图标, 前缀匹配 (system:todo:alarm 也算待办提醒)
    private val ICONS = listOf(
        "system:todo" to "alarm-clock",
        "system:guide" to "refresh-cw",
        "system:gh-auth" to "key-round",
        "system:gh" to "github",
        "system:cf" to "gauge",
    )
    private const val SYSTEM_ICON = "bell"

    fun avatarOf(sid: String?): String? = sid?.let { avatars[it] }

    fun all(): Set<String> = avatars.values.toSet()

    fun iconOf(sid: String?): String? = sid?.takeIf { it.startsWith(SYSTEM_PREFIX) }?.let { s -> ICONS.firstOrNull { s.startsWith(it.first) }?.second ?: SYSTEM_ICON }

    fun apply(body: JSONObject?) {
        val arr = body?.optJSONArray("senders") ?: return
        val next = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.associate { it.optString("sid") to it.optString("avatar") }.filter { it.key.isNotEmpty() && it.value.isNotEmpty() }
        avatars.keys.filter { it !in next }.forEach { avatars.remove(it) }
        next.forEach { (k, v) -> if (avatars[k] != v) avatars[k] = v }
    }

    fun setLocal(sid: String, avatar: String?) {
        if (avatar == null) avatars.remove(sid) else avatars[sid] = avatar
    }
}

/** 消息里的发送者头像: 主人设的图片 > 系统来源图标 > 字母头像。 */
@Composable
fun SenderAvatar(msg: ServerFrame.Msg, size: Dp, modifier: Modifier = Modifier) {
    val sid = msg.sid
    val avatar = Senders.avatarOf(sid)
    val icon = Senders.iconOf(sid)
    when {
        avatar != null -> ChatAvatar(Names.of(msg), avatar, size, modifier)
        icon != null -> Box(modifier.size(size).background(colorOf(sid ?: msg.src), CircleShape), contentAlignment = Alignment.Center) { Icon(icon, Color.White, size * ICON_RATIO) }
        else -> LetterAvatar(Names.of(msg), size, modifier)
    }
}

private const val ICON_RATIO = 0.55f

/** 点发送者头像: 主人可以换成图片或恢复默认; 上传与保存交给 ChatDirectory。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SenderAvatarSheet(msg: ServerFrame.Msg, dir: ChatDirectory, close: () -> Unit) {
    val sid = msg.sid ?: return close()
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val pick = rememberAvatarPicker({ error = it }) { bytes ->
        busy = true
        error = dir.setSenderAvatar(sid, bytes)
        busy = false
        if (error == null) close()
    }
    ModalBottomSheet(close) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 18.dp).padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SenderAvatar(msg, 44.dp)
                Column(Modifier.padding(start = 12.dp)) {
                    Text(Names.of(msg), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Text(sid, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                }
            }
            Text("这个发送者在所有群里的头像都会换掉, 其它设备同步。", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
            SheetRow(if (busy) "正在上传..." else "从相册选图片") { if (!busy) pick() }
            if (Senders.avatarOf(sid) != null) SheetRow("恢复默认") { dir.clearSenderAvatar(sid); close() }
            error?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun SheetRow(label: String, onClick: () -> Unit) {
    Text(label, Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp), fontSize = 15.sp, color = MaterialTheme.colorScheme.primary)
}
