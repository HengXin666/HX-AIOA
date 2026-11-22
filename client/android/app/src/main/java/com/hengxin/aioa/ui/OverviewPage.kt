package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.AnimatedItems
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.AdaptiveGrid
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.FeedItem
import com.hengxin.aioa.kit.LayerSection
import com.hengxin.aioa.kit.StatCard
import com.hengxin.aioa.kit.TaskCard
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.Tone
import com.hengxin.aioa.link.LinkLog
import java.util.Calendar

private const val ALERT_SRC_PREFIX = "probe"
private const val ALERT_WINDOW_MS = 24 * 60 * 60 * 1000L
private const val ALERTS_SHOWN = 3
private const val TITLE_NEED_ME = "需要我"
private const val TITLE_HAPPENING = "正在发生"

private sealed interface HomeTile {
    data class Cpu(val subject: String) : HomeTile
    data object Messages : HomeTile
}

/** 总览三层: 需要我 (等待确认的任务与重要告警), 正在发生 (动态与资源), 值得一看 (报告与摘要)。 */
@Composable
fun OverviewPage(chat: ChatModel, openGithub: () -> Unit, open: (Tab) -> Unit) {
    val feed = chat.feed
    WatchProbes(chat.metrics)
    val state = layerState(chat.online, feed.loaded, feed.updatedAt)
    PageColumn("总览") {
        Status(chat.online, chat.metrics.probes.size, feed.v1)
        if (feed.v1) V1Layers(chat, state, openGithub, open) else LegacyLayers(chat, state, open)
    }
}

@Composable
private fun V1Layers(chat: ChatModel, state: CardState, openGithub: () -> Unit, open: (Tab) -> Unit) {
    val feed = chat.feed
    val answer = rememberAnswer(chat)
    AnimatedItems(feed.tasks.values.filter { it.state == Constants.TASK_WAITING }.sortedByDescending { it.updated }, { it.id }) { task ->
        TaskCard(task.toCard(feed.pending[task.id]), onOption = { answer(task, it) }) { open(Tab.AGENT) }
    }
    LayerSection(TITLE_NEED_ME, "少而重要", items(feed, Constants.PRIORITY_NEED_ME), state, "一切正常, 没有需要处理的事") { open(Tab.CHAT) }
    LayerSection(TITLE_HAPPENING, "值得知道, 不必立即处理", items(feed, Constants.PRIORITY_HAPPENING), state, "暂时风平浪静") { open(Tab.CHAT) }
    ResourceTiles(chat, open)
    GithubOverviewCard(chat.github, openGithub)
    LayerSection("值得一看", "日报, 周报与摘要", items(feed, Constants.PRIORITY_WORTH_READING), state, "今天没有新内容") { open(Tab.CHAT) }
}

fun layerState(online: Boolean, loaded: Boolean, updatedAt: Long): CardState = when {
    !loaded && !online -> CardState.Error("未连接服务端, 正在重连")
    !loaded -> CardState.Loading
    !online && updatedAt > 0 -> CardState.Stale(LinkLog.clock(updatedAt))
    else -> CardState.Ready
}

// 任务由任务卡与 Agent 页展示, 层里只放事件与报告
private fun items(feed: FeedState, priority: String): List<FeedItem> =
    feed.layers[priority].orEmpty().filter { it.ev.kind != Constants.KIND_TASK }.map { it.toFeed() }

// 旧服务端只有消息: 近 24 小时的探针告警算 "需要我", 其余照旧
@Composable
private fun LegacyLayers(chat: ChatModel, state: CardState, open: (Tab) -> Unit) {
    val now = System.currentTimeMillis()
    val alerts = chat.messages.filter { it.src.startsWith(ALERT_SRC_PREFIX) && now - it.ts < ALERT_WINDOW_MS }
        .takeLast(ALERTS_SHOWN).reversed()
        .map { FeedItem(it.seq.toString(), "alert-triangle", it.text, null, it.src.removePrefix("$ALERT_SRC_PREFIX-"), ago(it.ts), Tone.Warning) }
    val shown = if (state is CardState.Loading) CardState.Ready else state
    LayerSection(TITLE_NEED_ME, "近 24 小时告警", alerts, shown, "一切正常, 没有需要处理的事") { open(Tab.CHAT) }
    PageSection(TITLE_HAPPENING)
    ResourceTiles(chat, open)
}

@Composable
private fun ResourceTiles(chat: ChatModel, open: (Tab) -> Unit) {
    val metrics = chat.metrics
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

@Composable
private fun Status(online: Boolean, probes: Int, v1: Boolean) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Dot(if (online) c.success else c.danger)
        val proto = if (v1) "" else " · 旧协议"
        Text(if (online) "已连接 · $probes 个探针在线$proto" else "未连接", c.textSecondary, 13)
    }
}

private fun startOfToday(): Long = Calendar.getInstance().apply {
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
}.timeInMillis
