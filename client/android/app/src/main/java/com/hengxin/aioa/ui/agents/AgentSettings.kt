package com.hengxin.aioa.ui.agents

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.ChatAgent
import com.hengxin.aioa.ui.chat.Onboard
import com.hengxin.aioa.ui.groupinfo.AgentGlyph
import com.hengxin.aioa.ui.groupinfo.GiDanger
import com.hengxin.aioa.ui.groupinfo.GiPage
import com.hengxin.aioa.ui.groupinfo.GiValue
import kotlinx.coroutines.launch

private const val CANCEL = "取消"

// 当前打开的弹层
private sealed interface Layer {
    data class Guide(val text: String) : Layer
    data class Send(val ob: Onboard) : Layer
    data object Edit : Layer
    data object Remove : Layer
    data class Auto(val on: Boolean) : Layer
}

/** 本群 + 其它几个; 空为只能发不能读。 */
fun readsText(group: String, reads: List<String>): String = when {
    reads.isEmpty() -> "只能发, 不能读"
    group in reads -> if (reads.size == 1) "本群" else "本群 + ${reads.size - 1} 个"
    else -> "${reads.size} 个群"
}

/**
 * Agent 设置 (#137, 按 #117 定论): 云 Agent 靠 skill 干活, 记忆在它自己那边, 触发方式由它上报。
 * 能改的只有名字, 可读的群, 大更新自动执行; 其余只读; 操作是复制接入语, 重新接入, 移出本群。
 */
@Composable
fun AgentSettingsPage(model: ChatModel, group: String, keyId: String, onBack: () -> Unit) {
    val dir = model.groups.directory
    val meta = dir.metas[group]
    val index = meta?.agents?.indexOfFirst { it.keyId == keyId } ?: -1
    val a = meta?.agents?.getOrNull(index)
    if (a == null) {
        // 被移出或群没了: 退回上一级
        LaunchedEffect(keyId) { onBack() }
        return
    }
    val c = Aioa.colors
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val now = rememberNow()
    val state = stateOf(a, a.keyId in model.groups.presence.listening(group, now))
    var layer by remember { mutableStateOf<Layer?>(null) }
    var copied by remember { mutableStateOf(false) }
    val fail = { e: Throwable -> dir.error = e.message }
    GiPage("Agent 设置", "${a.name} · ${meta.title ?: group}", onBack) {
        Panel(Modifier.padding(top = 14.dp).fillMaxWidth()) {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                AgentGlyph(agentTone(index), 56)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(a.name, c.text, 20, weight = FontWeight.SemiBold)
                    Text(stateLine(a, state, now) + if (a.pending) " · 指令待更新" else if (a.joined != null) " · 指令已同步" else "", c.textSecondary, 13)
                }
                AgentStateTag(a, state)
            }
        }
        dir.error?.let { e -> com.hengxin.aioa.ui.ErrorNote(e, Modifier.padding(top = 8.dp), onDismiss = { dir.error = null }) }
        HomeSection("基本") {
            GiValue("名字", a.name, false) { layer = Layer.Edit }
            GiValue("可读的群", readsText(group, a.reads) + (a.plugin?.let { " · 插件 $it" } ?: ""), true) { layer = Layer.Edit }
        }
        AgentRunSection(group, a, now)
        AgentVersionSection(group, a, now) { layer = Layer.Auto(it) }
        AgentRecordSection(model, group, a)
        HomeSection("接入") {
            HomeRow(if (copied) "已复制接入语" else "复制接入语", "装命令行, 登录, 装 skill, 建定时任务", end = { Icon("copy", c.textSecondary, 16.dp) }, onClick = {
                scope.launch { dir.savedPrompt(group, a.keyId).onSuccess { clipboard.setText(AnnotatedString(it)); copied = true }.onFailure(fail) }
            })
            HomeRow("查看指令", "按段展示当前接入语", divider = true, end = { Icon("file-text", c.textSecondary, 16.dp) }, onClick = {
                scope.launch { dir.savedPrompt(group, a.keyId).onSuccess { layer = Layer.Guide(it) }.onFailure(fail) }
            })
            HomeRow("重新接入", "作废旧密钥, 换一份新的接入语", divider = true, end = { Icon("refresh-cw", hxPalette().chart3, 16.dp) }, onClick = {
                scope.launch { dir.rotate(group, a.keyId).onSuccess { layer = Layer.Send(it) }.onFailure(fail) }
            })
        }
        HomeSection("") { GiDanger("移出本群", false) { layer = Layer.Remove } }
    }
    AgentLayers(model, group, a, layer, { layer = null }) { copied = false }
}

@Composable
private fun AgentLayers(model: ChatModel, group: String, a: ChatAgent, layer: Layer?, close: () -> Unit, onAuto: () -> Unit) {
    val dir = model.groups.directory
    val scope = rememberCoroutineScope()
    val danger = MaterialTheme.colorScheme.error
    when (layer) {
        is Layer.Guide -> GuideSheet(a.name, layer.text, close)
        is Layer.Send -> SendSheet(model, group, a.name, layer.ob, close)
        Layer.Edit -> EditDialog(model, group, a, { name, reads -> scope.launch { dir.editAgent(group, a.keyId, name, reads)?.let { dir.error = it } } }, close)
        Layer.Remove -> AlertDialog(
            onDismissRequest = close,
            title = { androidx.compose.material3.Text("移出 ${a.name}?") },
            text = { androidx.compose.material3.Text("它的密钥会立即作废, 已发的消息保留。") },
            confirmButton = { TextButton({ scope.launch { dir.removeAgent(group, a.keyId)?.let { dir.error = it } }; close() }) { androidx.compose.material3.Text("移出", color = danger) } },
            dismissButton = { TextButton(close) { androidx.compose.material3.Text(CANCEL) } },
        )
        is Layer.Auto -> AlertDialog(
            onDismissRequest = close,
            title = { androidx.compose.material3.Text(if (layer.on) "开启大更新自动执行?" else "关闭大更新自动执行?") },
            text = { androidx.compose.material3.Text("开着时 Agent 遇到大更新自己运行 hxaioa upgrade; 触发语会变, 需要把新接入语发给 Agent 一次。") },
            confirmButton = {
                TextButton({ scope.launch { dir.setAutoMajor(group, a.keyId, layer.on)?.let { dir.error = it } }; onAuto(); close() }) {
                    androidx.compose.material3.Text(if (layer.on) "开启" else "关闭")
                }
            },
            dismissButton = { TextButton(close) { androidx.compose.material3.Text(CANCEL) } },
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
        title = { androidx.compose.material3.Text("编辑 ${agent.name}") },
        text = { AgentForm(model, group, name, { name = it }, reads, { reads = it }) },
        confirmButton = { TextButton({ save(name.trim(), reads.toList()); close() }, enabled = name.isNotBlank()) { androidx.compose.material3.Text("保存") } },
        dismissButton = { TextButton(close) { androidx.compose.material3.Text(CANCEL) } },
    )
}
