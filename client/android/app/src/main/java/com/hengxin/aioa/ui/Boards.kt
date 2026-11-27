package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.FeedItem
import com.hengxin.aioa.kit.LayerSection
import com.hengxin.aioa.kit.ProgressBar
import com.hengxin.aioa.kit.TaskCard
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.Tone
import com.hengxin.aioa.proto.HostCard
import com.hengxin.aioa.ui.settings.CfUsageCard

private const val TASKS_SHOWN = 5

/** "开发" 看板: GitHub 动态, 等我确认的任务, 最近的 agent harness 任务。 */
@Composable
fun DevBoard(chat: ChatModel, openGithub: () -> Unit, open: (Tab) -> Unit) {
    val feed = chat.feed
    if (chat.github.enabled) GithubOverviewCard(chat.github, openGithub)
    val waiting = feed.tasks.values.filter { it.state == Constants.TASK_WAITING }.sortedByDescending { it.updated }
    waiting.forEach { task -> TaskCard(task.toCard(feed.pending[task.id]), onOption = null) { open(Tab.AGENT) } }
    val recent = feed.tasks.values.filter { it.state != Constants.TASK_WAITING }.sortedByDescending { it.updated }.take(TASKS_SHOWN).map { t ->
        val tone = when (t.state) {
            Constants.TASK_FAILED -> Tone.Critical
            Constants.TASK_DONE -> Tone.Info
            else -> Tone.Normal
        }
        FeedItem(t.id, Constants.ICON_ACTIVITY, t.title, t.step ?: t.summary, t.agent, ago(t.updated), tone)
    }
    val state = layerState(chat.online, feed.loaded, feed.updatedAt)
    LayerSection("${Constants.HARNESS} 任务", "进行中与最近结束", recent, state, "还没有任务") { open(Tab.AGENT) }
}

/** "服务器" 看板: 设备在线与心跳, 磁盘, CF 额度; 点进去到资源页看完整卡片。 */
@Composable
fun ServerBoard(chat: ChatModel, open: (Tab) -> Unit) {
    val c = Aioa.colors
    val hosts = chat.metrics.hosts
    if (hosts.isEmpty()) {
        Card(onClick = { open(Tab.RESOURCES) }) { CardHeader("server", "设备", "还没有探针, 到资源页添加主机") }
    } else {
        Card(onClick = { open(Tab.RESOURCES) }) {
            CardHeader("server", "设备", "${hosts.count { it.online }}/${hosts.size} 在线")
            hosts.forEach { h -> DeviceRow(chat.metrics, h) }
        }
        val disks = hosts.filter { it.diskTotal != null && it.last?.values?.get(FIELD_DISK) != null }
        if (disks.isNotEmpty()) {
            Card(onClick = { open(Tab.RESOURCES) }) {
                CardHeader("hard-drive", "存储")
                disks.forEach { h ->
                    val pct = h.last!!.values[FIELD_DISK]!!
                    val total = h.diskTotal!!
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(Modifier.fillMaxWidth()) {
                            Text(h.subject, c.text, 13, Modifier.weight(1f))
                            Text("${one(pct)}% · ${size(total * pct / PCT)} / ${size(total)}", c.textSecondary, 12)
                        }
                        ProgressBar((pct / PCT).toFloat())
                    }
                }
            }
        }
    }
    CfUsageCard()
    com.hengxin.aioa.ui.hxoa.HxoaSection()
}

@Composable
internal fun DeviceRow(state: MetricsState, h: HostCard) {
    val c = Aioa.colors
    val live = if (h.online) state.samples[h.subject]?.lastOrNull() else null
    val v = h.last?.values.orEmpty() + live?.values.orEmpty()
    val detail = if (h.online) {
        listOfNotNull("在线", v[FIELD_LOAD]?.let { "负载 ${one(it)}" }, v[FIELD_CPU]?.let { "CPU ${one(it)}%" }).joinToString(" · ")
    } else {
        "离线 · ${ago(h.seen)}失联"
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(if (h.online) c.success else c.danger)
            Spacer(Modifier.width(8.dp))
            Text(h.subject, c.text, 14, Modifier.weight(1f), FontWeight.Medium)
            Text(detail, c.textSecondary, 12)
        }
        beatsNow(h)?.let { HeartbeatBar(it, 12.dp, labels = false) }
    }
}
