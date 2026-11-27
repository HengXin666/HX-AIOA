package com.hengxin.aioa.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.data.groupKey
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.ChatAvatar

private val AVATAR = com.hengxin.aioa.ui.chat.MESSAGE_AVATAR
private val CORNER = 16.dp
private val EDGE = 12.dp

/** 应用内新消息横幅, 从顶部滑入, 点一下进对应的群。 */
@Composable
fun MessageBanner(chat: ChatModel, onOpen: () -> Unit) {
    val msg = chat.banner
    // 退场动画期间保留最后一条的内容
    var last by remember { mutableStateOf<ServerFrame.Msg?>(null) }
    if (msg != null) last = msg
    Box(Modifier.fillMaxWidth().statusBarsPadding(), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(
            visible = msg != null,
            enter = slideInVertically { -it } + fadeIn(),
            exit = slideOutVertically { -it } + fadeOut(),
        ) {
            val shown = last ?: return@AnimatedVisibility
            val key = shown.groupKey()
            Surface(
                Modifier.padding(EDGE).fillMaxWidth().clickable(onClick = onOpen),
                shape = RoundedCornerShape(CORNER),
                color = MaterialTheme.colorScheme.surfaceVariant,
                shadowElevation = 6.dp,
            ) {
                Row(Modifier.padding(EDGE), horizontalArrangement = Arrangement.spacedBy(EDGE), verticalAlignment = Alignment.CenterVertically) {
                    ChatAvatar(key, chat.groups.directory.metas[key]?.avatar, AVATAR)
                    Column(Modifier.weight(1f)) {
                        Text(chat.groups.directory.title(key), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(shown.text.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}
