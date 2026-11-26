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
import androidx.compose.material3.OutlinedTextField
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
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 发送者头像 (#123): 主人给来源 (sid) 设的图片头像, 服务端存, chat_sync senders 时重拉;
 * 没设的系统来源 (system:*) 画内置图标, 其余字母头像。
 */
/** 一个登记过的系统发送者 (#128)。 */
data class SenderInfo(val sid: String, val name: String, val alias: String?, val avatar: String?, val icon: String?, val last: Long) {
    val display: String get() = alias ?: name
}

object Senders {
    private val metas = mutableStateMapOf<String, SenderInfo>()
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
    private const val TERMINAL = "终端"

    /** 最近出现的在前。 */
    fun list(): List<SenderInfo> = metas.values.sortedByDescending { it.last }

    fun avatarOf(sid: String?): String? = sid?.let { metas[it]?.avatar }

    fun aliasOf(sid: String?): String? = sid?.let { metas[it]?.alias }

    fun all(): Set<String> = metas.values.mapNotNull { it.avatar }.toSet()

    fun iconOf(sid: String?): String? = when {
        sid == null -> null
        sid == TERMINAL -> "terminal"
        sid == "system" -> "layers"
        sid.startsWith(SYSTEM_PREFIX) -> ICONS.firstOrNull { sid.startsWith(it.first) }?.second ?: SYSTEM_ICON
        else -> null
    }

    fun apply(body: JSONObject?) {
        val arr = body?.optJSONArray("senders") ?: return
        val next = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map { o ->
            SenderInfo(
                o.optString("sid"), o.optString("name").ifEmpty { o.optString("sid") },
                o.optString("alias").ifEmpty { null }, o.optString("avatar").ifEmpty { null },
                o.optString("icon").ifEmpty { null }, o.optLong("last"),
            )
        }.filter { it.sid.isNotEmpty() }.associateBy { it.sid }
        metas.keys.filter { it !in next }.forEach { metas.remove(it) }
        next.forEach { (k, v) -> if (metas[k] != v) metas[k] = v }
    }

    fun setLocal(sid: String, change: (SenderInfo) -> SenderInfo) {
        metas[sid]?.let { metas[sid] = change(it) }
    }
}

/** 消息里的发送者头像: 主人设的图片 > 系统来源图标 > 字母头像。 */
@Composable
fun SenderAvatar(msg: ServerFrame.Msg, size: Dp, modifier: Modifier = Modifier) = SenderFace(msg.sid, Names.of(msg), size, modifier)

@Composable
fun SenderFace(sid: String?, name: String, size: Dp, modifier: Modifier = Modifier) {
    val avatar = Senders.avatarOf(sid)
    val icon = Senders.iconOf(sid)
    when {
        avatar != null -> ChatAvatar(name, avatar, size, modifier)
        icon != null -> Box(modifier.size(size).background(colorOf(sid ?: name), CircleShape), contentAlignment = Alignment.Center) { Icon(icon, Color.White, size * ICON_RATIO) }
        else -> LetterAvatar(name, size, modifier)
    }
}

private const val ICON_RATIO = 0.55f

/** 改系统发送者的名字和头像 (消息里点头像, 或系统发送者页点一行)。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SenderEditSheet(sid: String, fallbackName: String, dir: ChatDirectory, close: () -> Unit) {
    val info = Senders.list().find { it.sid == sid }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf(info?.alias ?: "") }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val pick = rememberAvatarPicker({ error = it }) { bytes ->
        busy = true
        error = dir.setSenderAvatar(sid, bytes)
        busy = false
    }
    ModalBottomSheet(close) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 18.dp).padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SenderFace(sid, info?.display ?: fallbackName, 48.dp, Modifier.clickable { if (!busy) pick() })
                Column(Modifier.padding(start = 12.dp)) {
                    Text(info?.display ?: fallbackName, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Text(if (info?.alias != null) "$sid · 默认名 ${info.name}" else sid, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                }
            }
            if (info == null) {
                Text("这个发送者还没登记 (不是系统发送者), 只能看。", fontSize = 13.sp, color = MaterialTheme.colorScheme.outline)
            } else {
                OutlinedTextField(name, { name = it.take(NAME_MAX) }, Modifier.fillMaxWidth(), label = { Text("名字 (留空用默认名 ${info.name})") }, singleLine = true)
                SheetRow("保存名字") {
                    scope.launch { error = dir.renameSender(sid, name.trim().ifEmpty { null }); if (error == null) close() }
                }
                SheetRow(if (busy) "正在上传..." else "换头像") { if (!busy) pick() }
                if (info.avatar != null) SheetRow("头像恢复默认") { dir.clearSenderAvatar(sid) }
                Text("所有群里这个发送者都会换掉, 其它设备同步; 改名后新消息按新名字发。", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
            }
            error?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error) }
        }
    }
}

private const val NAME_MAX = 32

@Composable
private fun SheetRow(label: String, onClick: () -> Unit) {
    Text(label, Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp), fontSize = 15.sp, color = MaterialTheme.colorScheme.primary)
}
