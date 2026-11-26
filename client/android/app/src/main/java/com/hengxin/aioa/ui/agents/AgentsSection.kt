package com.hengxin.aioa.ui.agents

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.ChatAgent
import com.hengxin.aioa.ui.chat.Onboard
import kotlinx.coroutines.launch

enum class AgentAction { GUIDE, ROTATE, EDIT, REMOVE }

// 当前打开的那一层
private sealed interface Layer {
    data object Wizard : Layer
    data class Detail(val keyId: String) : Layer
    data class Guide(val name: String, val text: String) : Layer
    data class Send(val name: String, val ob: Onboard) : Layer
    data class Edit(val agent: ChatAgent) : Layer
    data class Remove(val agent: ChatAgent) : Layer
}

/** 群设置里的 Agent 区: 每个 Agent 一张状态卡, 点开看详情, 操作收进 ⋯; 接入走三步向导。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AgentsSection(model: ChatModel, group: String, agents: List<ChatAgent>) {
    val dir = model.groups.directory
    val scope = rememberCoroutineScope()
    val c = MaterialTheme.colorScheme
    val now = rememberNow()
    val listening = model.groups.presence.listening(group, now)
    var layer by remember { mutableStateOf<Layer?>(null) }
    val act = { a: ChatAgent, action: AgentAction ->
        when (action) {
            AgentAction.GUIDE -> scope.launch { dir.savedPrompt(group, a.keyId).onSuccess { layer = Layer.Guide(a.name, it) }.onFailure { dir.error = it.message } }
            AgentAction.ROTATE -> scope.launch { dir.rotate(group, a.keyId).onSuccess { layer = Layer.Send(a.name, it) }.onFailure { dir.error = it.message } }
            AgentAction.EDIT -> layer = Layer.Edit(a)
            AgentAction.REMOVE -> layer = Layer.Remove(a)
        }
        Unit
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Agent", Modifier.weight(1f), fontSize = 15.sp)
            TextButton({ layer = Layer.Wizard }) { Text("+ 接入") }
        }
        if (agents.isEmpty()) Text("接入后它就能往这个群发消息, 读你允许的群, 三步就好。", fontSize = 12.sp, color = c.outline)
        agents.forEach { a ->
            val state = stateOf(a, a.keyId in listening)
            var menu by remember { mutableStateOf(false) }
            Row(Modifier.fillMaxWidth().clickable { layer = Layer.Detail(a.keyId) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                StatusDot(state)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(a.name, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    Text(stateLine(a, state, now), fontSize = 12.sp, color = c.outline)
                    FlowRow(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        AgentTag(if (a.reads.isEmpty()) "只发不读" else "可读 ${a.reads.size} 个群")
                        a.plugin?.let { AgentTag("插件") }
                        SkillTags(group, a, now)
                    }
                }
                Box {
                    Box(Modifier.size(36.dp).clickable { menu = true }, contentAlignment = Alignment.Center) { Text("⋯", fontSize = 20.sp, color = c.outline) }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem({ Text("查看指令") }, { menu = false; act(a, AgentAction.GUIDE) })
                        DropdownMenuItem({ Text("编辑") }, { menu = false; act(a, AgentAction.EDIT) })
                        DropdownMenuItem({ Text("重新接入") }, { menu = false; act(a, AgentAction.ROTATE) })
                        DropdownMenuItem({ Text("移除", color = c.error) }, { menu = false; act(a, AgentAction.REMOVE) })
                    }
                }
            }
        }
    }
    when (val l = layer) {
        Layer.Wizard -> AgentWizard(model, group) { layer = null }
        is Layer.Detail -> agents.firstOrNull { it.keyId == l.keyId }?.let { a ->
            AgentDetail(model, group, a, stateOf(a, a.keyId in listening), { act(a, it) }) { layer = null }
        } ?: run { layer = null }
        is Layer.Guide -> GuideSheet(l.name, l.text) { layer = null }
        is Layer.Send -> SendSheet(model, group, l.name, l.ob) { layer = null }
        is Layer.Edit -> EditDialog(model, group, l.agent, { name, reads ->
            scope.launch { dir.editAgent(group, l.agent.keyId, name, reads)?.let { dir.error = it } }
        }) { layer = null }
        is Layer.Remove -> AlertDialog(
            onDismissRequest = { layer = null },
            title = { Text("移除 ${l.agent.name}?") },
            text = { Text("它的密钥会立即作废, 已发的消息保留。") },
            confirmButton = { TextButton({ scope.launch { dir.removeAgent(group, l.agent.keyId)?.let { dir.error = it } }; layer = null }) { Text("移除", color = c.error) } },
            dismissButton = { TextButton({ layer = null }) { Text("取消") } },
        )
        null -> Unit
    }
}

@Composable
private fun EditDialog(model: ChatModel, group: String, agent: ChatAgent, save: (String, List<String>) -> Unit, close: () -> Unit) {
    var name by remember { mutableStateOf(agent.name) }
    var reads by remember { mutableStateOf(agent.reads.toSet()) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text("编辑 ${agent.name}") },
        text = { AgentForm(model, group, name, { name = it }, reads, { reads = it }) },
        confirmButton = { TextButton({ save(name.trim(), reads.toList()); close() }, enabled = name.isNotBlank()) { Text("保存") } },
        dismissButton = { TextButton(close) { Text("取消") } },
    )
}
