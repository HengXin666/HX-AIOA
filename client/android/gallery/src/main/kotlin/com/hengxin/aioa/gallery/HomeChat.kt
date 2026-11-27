package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CountChip
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.enter
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap

// 消息空间: Telegram 式会话列表, 顶部筛选; 点进去才是 QQ 式会话页

private data class Chat(
    val name: String,
    val preview: String,
    val time: String,
    val initial: String,
    val tone: Int,
    val unread: Int = 0,
    val agent: Boolean = false,
    val typing: Boolean = false,
    val pinned: Boolean = false,
    val muted: Boolean = false,
)

private val CHATS = listOf(
    Chat("DSH", "镜像已推送, 等你确认部署", "20:49", "D", 4, unread = 1, agent = true, pinned = true),
    Chat("oa_1", "正在输入…", "20:48", "1", 2, agent = true, typing = true, pinned = true),
    Chat("点子待办", "イデア: 已建 issue #121 安卓 UI 专项", "00:21", "点", 3, unread = 2),
    Chat("GitHub 动态", "HX-AIOA 推送 2 个提交到 main", "00:04", "G", 5),
    Chat("家里服务器", "nas-01: 夜间备份完成, 用时 14 分钟", "昨天", "家", 2),
    Chat("福利", "Steam 冬促清单已更新, 3 个史低", "昨天", "福", 3, muted = true),
    Chat("Kotlin 群", "Compose 1.8 的共享元素有人用了吗", "周三", "K", 4, unread = 12, muted = true),
)

@Composable
internal fun ChatSpace() {
    val c = Aioa.colors
    Row(Modifier.padding(top = 12.dp, bottom = 6.dp).enter(0), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("全部" to true, "未读 3" to false, "群" to false, "Agent" to false).forEach { (t, on) ->
            Text(
                t, if (on) c.background else c.textSecondary, 13,
                Modifier.clip(RoundedCornerShape(9.dp)).background(if (on) c.text else c.surface).padding(horizontal = 12.dp, vertical = 6.dp),
                weight = FontWeight.Medium,
            )
        }
    }
    CHATS.forEachIndexed { i, ch -> ChatRow(ch, i > 0, Modifier.enter(i + 1)) }
}

@Composable
private fun ChatRow(ch: Chat, divider: Boolean, modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val tone: Color = listOf(pal.chart1, pal.chart2, pal.chart3, pal.chart4, pal.chart5).getOrElse(ch.tone - 1) { pal.chart2 }
    Column(modifier.fillMaxWidth().pointerTap {}) {
        if (divider) Box(Modifier.padding(start = 64.dp).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        Row(Modifier.padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Initial(ch.initial, 52, tone)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(ch.name, c.text, 16, weight = FontWeight.SemiBold)
                    if (ch.agent) SoftTag("Agent", pal.chart2)
                    if (ch.muted) Icon("bell-off", c.textSecondary, 13.dp)
                    Spacer(Modifier.weight(1f))
                    Text(ch.time, c.textSecondary, 12)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(ch.preview, if (ch.typing) pal.chart2 else c.textSecondary, 14, Modifier.weight(1f))
                    when {
                        ch.unread > 0 -> CountChip(ch.unread, strong = !ch.muted)
                        ch.pinned -> Icon("pin", c.textSecondary, 14.dp)
                    }
                }
            }
        }
    }
}
