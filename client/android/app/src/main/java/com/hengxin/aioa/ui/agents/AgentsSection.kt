package com.hengxin.aioa.ui.agents

import com.hengxin.aioa.Constants
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pressable
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.ChatAgent
import com.hengxin.aioa.ui.groupinfo.AgentGlyph
import com.hengxin.aioa.ui.groupinfo.GiNote
import com.hengxin.aioa.ui.groupinfo.LINE_ALPHA

private const val GLYPH = 28

/** Agent 的颜色: 按在群里的顺序轮换图表色。 */
@Composable
fun agentTone(i: Int): Color {
    val p = hxPalette()
    return listOf(p.chart2, p.chart3, p.chart4, p.chart5)[Math.floorMod(i, 4)]
}

/** 状态标签: 运行中 / 监听中 / 待报到 / 未接入 / 插件。 */
@Composable
fun AgentStateTag(a: ChatAgent, state: AgentState) {
    val c = Aioa.colors
    when {
        state == AgentState.WAITING -> SoftTag("未报到", c.textSecondary)
        state == AgentState.PENDING -> SoftTag("待报到", c.warning)
        state == AgentState.LISTENING -> SoftTag("监听中", c.success)
        a.plugin != null -> SoftTag("插件", c.textSecondary)
        else -> SoftTag("运行中", hxPalette().chart2)
    }
}

/** 群聊设置与成员页里的 Agent 区 (#137): 一行一条, 点进 Agent 设置; 右上 "接入" 走三步向导。 */
@Composable
fun AgentsSection(model: ChatModel, group: String, agents: List<ChatAgent>, openAgent: (String) -> Unit) {
    val now = rememberNow()
    val listening = model.groups.presence.listening(group, now)
    var wizard by remember { mutableStateOf(false) }
    HomeSection(Constants.CLOUD_AGENT, agents.size, action = "接入", onAction = { wizard = true }) {
        if (agents.isEmpty()) GiNote("接入后它就能往这个群发消息, 读你允许的群, 三步就好。")
        agents.forEachIndexed { i, a -> AgentLine(group, a, stateOf(a, a.keyId in listening), i, now) { openAgent(a.keyId) } }
    }
    if (wizard) AgentWizard(model, group) { wizard = false }
}

@Composable
private fun AgentLine(group: String, a: ChatAgent, state: AgentState, i: Int, now: Long, onClick: () -> Unit) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().pressable(onClick)) {
        if (i > 0) Box(Modifier.padding(start = 54.dp).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = LINE_ALPHA)))
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AgentGlyph(agentTone(i), GLYPH, a.sourceId)
            Text(com.hengxin.aioa.ui.chat.MentionOps.agentName(a), c.text, 15, Modifier.padding(start = 4.dp), weight = FontWeight.Medium)
            Text(stateLine(a, state, now), c.textSecondary, 12, Modifier.weight(1f))
            if (a.reads.isNotEmpty()) {
                Icon("eye", c.textSecondary, 12.dp)
                Text("${a.reads.size}", c.textSecondary, 11)
            }
            SkillMarks(group, a, now)
            AgentStateTag(a, state)
        }
    }
}
