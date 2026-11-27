package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.ui.agents.rememberNow
import com.hengxin.aioa.ui.chat.ChatMeta
import com.hengxin.aioa.ui.chat.SubBar
import com.hengxin.aioa.ui.chat.digestLabel

private const val NOTICE_LINES = 8

/** 顶栏副标题: 有人输入 / 监听时顶替; 单聊 "真人"; 多人群 "n 人 · m 个 Agent"。 */
internal fun roomSub(meta: ChatMeta?, online: Boolean): String {
    if (!online) return "未连接"
    val agents = meta?.agents?.size ?: 0
    return when {
        meta?.isDm == true -> "真人"
        meta?.shared == true -> "${meta.members} 人 · $agents 个 Agent"
        else -> listOfNotNull(
            digestLabel(meta?.digest),
            if (meta?.muted == true) "免打扰" else null,
            agents.takeIf { it > 0 }?.let { "$it 个 Agent" },
        ).joinToString(" · ")
    }
}

/** 会话页顶栏 (#136): 返回 (带别处未读), 群名 + 副标题, 右上进群设置; 下面群公告条 (#133)。 */
@Composable
internal fun RoomBar(model: ChatModel, group: String, onBack: () -> Unit) {
    val c = Aioa.colors
    val g = model.groups
    val meta = g.directory.metas[group]
    val now = rememberNow()
    val live = if (model.online) g.presence.line(group, now) else null
    val elsewhere = g.rows().filter { it.key != group && !it.muted }.sumOf { it.unread }
    val settings = { g.page = ChatPage.SETTINGS }
    Column {
        SubBar(
            meta?.title ?: group, live ?: roomSub(meta, model.online), onBack, onRight = settings, onTitle = settings,
            subTone = when {
                live != null -> hxPalette().chart2
                !model.online -> c.warning
                else -> null
            },
            backCount = elsewhere,
        )
        meta?.notice?.takeIf { it.isNotBlank() }?.let { notice ->
            var open by rememberSaveable(group) { mutableStateOf(false) }
            Row(
                Modifier.fillMaxWidth().background(c.surface.copy(alpha = 0.6f)).pointerTap { open = !open }.padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon("megaphone", hxPalette().chart3, 16.dp)
                Text("群公告: $notice", c.text, 13, Modifier.weight(1f), maxLines = if (open) NOTICE_LINES else 1)
                Icon(if (open) "chevron-up" else "chevron-down", c.textSecondary, 14.dp)
            }
        }
    }
}
