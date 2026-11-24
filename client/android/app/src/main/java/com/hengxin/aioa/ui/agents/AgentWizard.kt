package com.hengxin.aioa.ui.agents

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.Onboard
import kotlinx.coroutines.launch

private const val STEPS = 3
private const val NAME_MAX = 40

// 任务模板: 名字, 一句话任务, 建议间隔 (秒)
private data class Template(val label: String, val task: String, val interval: Int?)
private val TEMPLATES = listOf(
    Template("定时汇总", "把群里上次之后的新消息汇总成一条简报发到本群, 没有新消息就不发。", 3600),
    Template("整理待办", "把我在群里说的要做的事整理成清单, 每条引用回复, 做完的标出来。", 1800),
    Template("回答提问", "我在群里问你的问题, 读完上下文后引用回复, 回复后再等我 5 分钟。", 300),
    Template("自定义", "", null),
)
private val INTERVALS = listOf(null to "不定时", 300 to "5 分钟", 1800 to "30 分钟", 3600 to "1 小时", 86400 to "每天")

/** 名字 + 可读的群, 接入向导第一步和编辑共用。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AgentForm(model: ChatModel, group: String, name: String, setName: (String) -> Unit, reads: Set<String>, setReads: (Set<String>) -> Unit) {
    val groups = remember { model.groups.rows().map { it.key }.filter { it != MessageDb.MEMO_GROUP } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(name, { setName(it.take(NAME_MAX)) }, Modifier.fillMaxWidth(), label = { Text("叫什么") }, singleLine = true)
        Text("能读哪些群", fontSize = 13.sp, fontWeight = FontWeight.Medium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            groups.forEach { k ->
                val label = if (k == group) "本群" else model.groups.directory.title(k)
                FilterChip(k in reads, { setReads(if (k in reads) reads - k else reads + k) }, { Text(label) })
            }
        }
        Text("不勾本群就只能发不能读, 看不到你在群里对它说的话。", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
    }
}

/** 接入向导: 1 名字与可读群, 2 任务与定时, 3 发给 Agent 并等它报到。 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AgentWizard(model: ChatModel, group: String, close: () -> Unit) {
    val dir = model.groups.directory
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf(1) }
    var name by remember { mutableStateOf("") }
    var reads by remember { mutableStateOf(setOf(group)) }
    var template by remember { mutableStateOf<Template?>(null) }
    var task by remember { mutableStateOf("") }
    var interval by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf<Onboard?>(null) }
    ModalBottomSheet(onDismissRequest = { if (!busy) close() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("接入 Agent · 第 $step / $STEPS 步", fontSize = 13.sp, color = MaterialTheme.colorScheme.outline)
            when (step) {
                1 -> {
                    Text("叫什么, 能读哪些群", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    AgentForm(model, group, name, { name = it }, reads, { reads = it })
                }
                2 -> {
                    Text("让它做什么", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        TEMPLATES.forEach { t ->
                            FilterChip(template == t, {
                                template = t
                                task = t.task
                                interval = t.interval
                            }, { Text(t.label) })
                        }
                    }
                    OutlinedTextField(task, { task = it }, Modifier.fillMaxWidth(), label = { Text("任务 (可以留空, 之后在它那边布置)") }, minLines = 2)
                    Text("多久跑一次", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        INTERVALS.forEach { (v, label) -> FilterChip(interval == v, { interval = v }, { Text(label) }) }
                    }
                }
                else -> done?.let { SendPane(model, group, name, it) }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            Row(Modifier.fillMaxWidth()) {
                if (step == 2) TextButton({ step = 1 }) { Text("上一步") }
                Spacer(Modifier.weight(1f))
                when (step) {
                    1 -> Button({ step = 2 }, enabled = name.isNotBlank()) { Text("下一步") }
                    2 -> Button({
                        busy = true
                        error = null
                        scope.launch {
                            dir.addAgent(group, name.trim(), reads.toList(), interval, task.takeIf { it.isNotBlank() })
                                .onSuccess { done = it; step = 3 }
                                .onFailure { error = it.message }
                            busy = false
                        }
                    }, enabled = !busy) { Text(if (busy) "正在生成..." else "生成接入语") }
                    else -> Button(close) { Text("完成") }
                }
            }
        }
    }
}
