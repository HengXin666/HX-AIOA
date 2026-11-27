package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap

private val LIST_MAX = 280.dp
private val FACE = 32.dp
private const val CARD_R = 16

/** 输入 "@" 弹出的选择卡: 全体成员, Agent, 真人。 */
@Composable
fun MentionList(list: List<MentionTarget>, onPick: (MentionTarget) -> Unit) {
    val c = Aioa.colors
    val shape = RoundedCornerShape(CARD_R.dp)
    Column(
        Modifier.padding(horizontal = 10.dp, vertical = 6.dp).fillMaxWidth().shadow(16.dp, shape).clip(shape).background(c.popover)
            .border(1.dp, c.border.copy(alpha = 0.6f), shape).heightIn(max = LIST_MAX).verticalScroll(rememberScrollState()).padding(vertical = 6.dp),
    ) {
        Text(if (list.isEmpty()) "没有匹配的人或 Agent" else "选择要 @ 的人", c.textSecondary, 12, Modifier.padding(start = 14.dp, top = 4.dp, bottom = 4.dp))
        list.forEach { t ->
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 6.dp).clip(RoundedCornerShape(10.dp)).pointerTap { onPick(t) }.padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                when {
                    t.agent -> AgentFace(colorOf(t.sid ?: t.token), FACE)
                    t.token == com.hengxin.aioa.proto.Mentions.ALL -> Box(Modifier.size(FACE).clip(RoundedCornerShape(9.dp)).background(c.surfaceAlt), contentAlignment = Alignment.Center) { Icon("users", c.text, 16.dp) }
                    else -> SenderFace(t.sid, t.label, FACE)
                }
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f, fill = false)) { Text(t.label, c.text, 15, weight = FontWeight.Medium) }
                    if (t.agent) SoftTag("Agent", colorOf(t.sid ?: t.token))
                }
                Text(t.sub, c.textSecondary, 12)
            }
        }
    }
}

/** Agent 头像: 圆角方块 + 机器人图标 (只有真人头像是圆的)。 */
@Composable
fun AgentFace(tone: Color, size: Dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(RoundedCornerShape(size * AGENT_R)).background(tone.copy(alpha = AGENT_BG)), contentAlignment = Alignment.Center) {
        Icon("bot", tone, size * AGENT_ICON)
    }
}

private const val AGENT_R = 0.3f
private const val AGENT_BG = 0.18f
private const val AGENT_ICON = 0.5f
