package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.AdaptiveGrid
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.StatCard
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.proto.ServerFrame
import java.util.Calendar

private const val ALERT_SRC_PREFIX = "probe"
private const val ALERT_WINDOW_MS = 24 * 60 * 60 * 1000L
private const val ALERTS_SHOWN = 3

private sealed interface HomeTile {
    data class Cpu(val subject: String) : HomeTile
    data object Messages : HomeTile
}

/** 总览: 需要我 (近 24 小时探针告警), 正在发生 (各探针 CPU + 今日消息)。 */
@Composable
fun OverviewPage(chat: ChatModel, open: (Tab) -> Unit) {
    val metrics = chat.metrics
    WatchProbes(metrics)
    val now = System.currentTimeMillis()
    val alerts = chat.messages.filter { it.src.startsWith(ALERT_SRC_PREFIX) && now - it.ts < ALERT_WINDOW_MS }
        .takeLast(ALERTS_SHOWN).reversed()
    PageColumn("总览") {
        Status(chat.online, metrics.probes.size)
        Section("需要我")
        if (alerts.isEmpty()) {
            Card { Text("一切正常, 没有需要处理的事", Aioa.colors.textSecondary, 14) }
        }
        alerts.forEach { Alert(it) { open(Tab.CHAT) } }
        Section("正在发生")
        val tiles = metrics.probes.map { HomeTile.Cpu(it) } + HomeTile.Messages
        AdaptiveGrid(tiles) { tile ->
            when (tile) {
                is HomeTile.Cpu -> {
                    val cpu = metrics.series(tile.subject, KEY_CPU).map { it.second }
                    StatCard(
                        "cpu", "CPU", cpu.lastOrNull() ?: 0f, PERCENT,
                        state = if (cpu.isEmpty()) CardState.Loading else CardState.Ready,
                        delta = tile.subject, trend = cpu, source = SOURCE_PROBE,
                    ) { open(Tab.RESOURCES) }
                }
                HomeTile.Messages -> {
                    val today = chat.messages.count { it.ts >= startOfToday() }
                    StatCard(
                        "message-circle", "今日消息", today.toFloat(), "条",
                        delta = chat.messages.lastOrNull()?.text, source = "HX-AIOA",
                    ) { open(Tab.CHAT) }
                }
            }
        }
        if (metrics.probes.isEmpty()) NoProbe()
    }
}

@Composable
private fun Status(online: Boolean, probes: Int) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Dot(if (online) c.success else c.danger)
        Text(if (online) "已连接 · $probes 个探针在线" else "未连接", c.textSecondary, 13)
    }
}

@Composable
private fun Alert(msg: ServerFrame.Msg, onClick: () -> Unit) {
    Card(onClick = onClick) {
        CardHeader("alert-triangle", msg.src.removePrefix("$ALERT_SRC_PREFIX-"), clock(msg.ts))
        Text(msg.text, Aioa.colors.text, 14)
    }
}

private fun startOfToday(): Long = Calendar.getInstance().apply {
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
}.timeInMillis
