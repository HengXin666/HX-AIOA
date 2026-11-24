package com.hengxin.aioa.ui.agents

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.ChatAgent
import com.hengxin.aioa.ui.chat.plainPreview
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val RECENT = 5
private const val PREVIEW = 60
private val TIME = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)

/** Agent 详情: 状态, 时间线, 可读的群, 最近发的几条; 底部是操作。 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AgentDetail(model: ChatModel, group: String, a: ChatAgent, state: AgentState, act: (AgentAction) -> Unit, close: () -> Unit) {
    val context = LocalContext.current
    val c = MaterialTheme.colorScheme
    val now = rememberNow()
    var recent by remember { mutableStateOf<List<ServerFrame.Msg>>(emptyList()) }
    LaunchedEffect(a.sourceId) {
        val sid = a.sourceId ?: return@LaunchedEffect
        recent = withContext(Dispatchers.IO) { MessageDb.get(context).bySource(sid, RECENT) }
    }
    ModalBottomSheet(onDismissRequest = close) {
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusDot(state, 12.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(a.name, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Text(stateLine(a, state, now) + if (a.pending) " · 指令待更新" else if (a.joined != null) " · 指令已同步" else "", fontSize = 12.sp, color = c.outline)
                }
            }
            Text("时间线", fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Step("接入", a.created)
                a.rotated?.let { Step("重新接入", it) }
                Step("报到", a.joined)
                Step("最近活跃", a.active)
                Step("最近发言", recent.firstOrNull()?.ts)
            }
            Text("能读的群", fontSize = 13.sp, fontWeight = FontWeight.Medium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (a.reads.isEmpty()) Text("只能发, 不能读", fontSize = 13.sp, color = c.outline)
                a.reads.forEach { r -> AssistChip({ act(AgentAction.EDIT) }, { Text(if (r == group) "本群" else model.groups.directory.title(r)) }) }
                a.plugin?.let { AssistChip({}, { Text("插件: $it") }) }
            }
            if (recent.isNotEmpty()) {
                Text("最近发的", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                recent.forEach { m ->
                    Row(Modifier.fillMaxWidth().clickable { close(); model.groups.page = com.hengxin.aioa.ui.ChatPage.CHAT; model.groups.openAt(group, m.seq) }.padding(vertical = 4.dp)) {
                        Text(TIME.format(Date(m.ts)), fontSize = 12.sp, color = c.outline, modifier = Modifier.width(84.dp))
                        Text(plainPreview(m.text).take(PREVIEW), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton({ act(AgentAction.GUIDE) }) { Text("查看指令") }
                TextButton({ act(AgentAction.EDIT) }) { Text("编辑") }
                TextButton({ act(AgentAction.ROTATE) }) { Text("重新接入") }
                TextButton({ act(AgentAction.REMOVE) }) { Text("移除", color = c.error) }
            }
        }
    }
}

@Composable
private fun Step(label: String, ts: Long?) {
    val c = MaterialTheme.colorScheme
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(if (ts != null) "●" else "○", fontSize = 10.sp, color = if (ts != null) c.primary else c.outline)
        Spacer(Modifier.width(8.dp))
        Text(label, fontSize = 14.sp, modifier = Modifier.width(80.dp))
        Text(ts?.let { TIME.format(Date(it)) } ?: "还没有", fontSize = 13.sp, color = c.outline)
    }
}
